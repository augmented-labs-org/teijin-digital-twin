#!/usr/bin/env python3
"""
Simulated factory -> Coreflux MQTT broker.

Mirrors *exactly* the topic-bound stats wired up in apps/web/src/core/world.ts.
world.ts is the source of truth: it subscribes to a fixed set of topics and this
simulator publishes that set and nothing else. Every metric published here maps
to a stat the web app actually renders.

What world.ts consumes:
    Building "Factory" / Floor 0
      ├─ Area "Factory"
      │    ├─ temperature, power, output                     (area sensors)
      │    ├─ equipment "painter": color, temperature0..2
      │    └─ equipment "press0".."press4": actuation, force
      ├─ Area "Warehouse 1": capacity, humidity
      └─ Area "Lab 1": temperature, air_quality_pm25

Topic layout (matches world.ts EntityStat.topic strings verbatim):
    factory/floor-0/<area-slug>/<metric>
    factory/floor-0/factory/equipments/<equipment-slug>/<metric>
    factory/status                                          (retained, LWT)

Payload (JSON):
    {"value": 23.7, "unit": "degC", "ts": "2026-07-22T15:04:05.123456+00:00"}

Run:
    pip install paho-mqtt
    python3 factory.py
"""

from __future__ import annotations

import json
import random
import signal
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import paho.mqtt.client as mqtt

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

BROKER_HOST = "192.168.1.232"   # Coreflux broker
BROKER_PORT = 1883
KEEPALIVE = 60

# Optional auth — leave as None for an open broker.
USERNAME: Optional[str] = None
PASSWORD: Optional[str] = None

CLIENT_ID = "factory-simulator"
TOPIC_ROOT = "factory"
PUBLISH_INTERVAL_S = 2.0        # seconds between full sensor sweeps
QOS = 0

# Probability, per press per sweep, of a fault appearing / clearing.
FAULT_ONSET_P = 0.01
FAULT_CLEAR_P = 0.25

# Minimum time a press holds a running state before it may toggle again.
PRESS_RUN_COOLDOWN_S = 5.0


def slug(name: str) -> str:
    return name.strip().lower().replace(" ", "-")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Simulated sensors
# --------------------------------------------------------------------------- #


@dataclass
class Sensor:
    """A scalar sensor driven by a bounded random walk (Ornstein-Uhlenbeck-ish)."""

    metric: str
    unit: str
    value: float
    low: float
    high: float
    step: float                 # max jitter applied per sweep
    precision: int = 1
    mean_revert: float = 0.02   # pull back toward the midpoint each sweep

    def tick(self) -> float:
        mid = (self.low + self.high) / 2.0
        drift = (mid - self.value) * self.mean_revert
        self.value += drift + random.uniform(-self.step, self.step)
        self.value = max(self.low, min(self.high, self.value))
        return round(self.value, self.precision)

    def payload(self) -> str:
        return json.dumps({"value": self.tick(), "unit": self.unit, "ts": now_iso()})


@dataclass
class IntSensor(Sensor):
    """Integer-valued sensor (output/h, ...)."""

    def tick(self) -> float:
        super().tick()
        self.value = round(self.value)
        return int(self.value)


@dataclass
class BoolSensor:
    """A switch/actuation style sensor that flips occasionally."""

    metric: str
    value: bool
    flip_p: float = 0.2
    unit: str = "bool"

    def tick(self) -> bool:
        if random.random() < self.flip_p:
            self.value = not self.value
        return self.value

    def payload(self) -> str:
        return json.dumps({"value": self.tick(), "unit": self.unit, "ts": now_iso()})


@dataclass
class ChoiceSensor:
    """A categorical sensor that occasionally switches to a new choice (e.g. paint color)."""

    metric: str
    choices: list[str]
    index: int = 0
    change_p: float = 0.1
    unit: str = ""

    def tick(self) -> str:
        if random.random() < self.change_p:
            self.index = random.randrange(len(self.choices))
        return self.choices[self.index]

    def payload(self) -> str:
        return json.dumps({"value": self.tick(), "unit": self.unit, "ts": now_iso()})


# --------------------------------------------------------------------------- #
# Simulated equipment
# --------------------------------------------------------------------------- #


@dataclass
class Equipment:
    """
    A machine hanging off the Factory area. Publishes only the metrics world.ts
    reads for it — no online/running/error status topic, because world.ts does
    not subscribe to one. Its telemetry lives under
    factory/floor-0/factory/equipments/<slug>/<metric>.
    """

    slug: str
    sensors: list = field(default_factory=list)


class Press(Equipment):
    """
    A hydraulic press. Publishes, under factory/floor-0/factory/equipments/<slug>:
      - actuation (bool)  : ON while the ram is stroking
      - force (N)         : high while actuating, decaying toward zero when idle
      - status (object)   : {status, online, running, errored, errorReason} —
                            consumed by impl.ts to drive the press-down/up
                            animations and the equipment status label.

    `running` and `actuation` move together (the press actuates while it runs),
    and `force` follows that state, so all three topics tell one story. A press
    occasionally faults, which drops it out of the running/actuating cycle and
    surfaces an `errorReason` until it recovers.
    """

    FAULTS = ["Seal leak", "Over-pressure", "Ram jam", "Hydraulic pressure low"]

    def __init__(self, slug: str) -> None:
        super().__init__(slug=slug, sensors=[])
        self.online = True
        self.running = True
        self.errored = False
        self.error_reason: Optional[str] = None
        self._force = 0.0
        self._last_run_change = time.monotonic()

    @property
    def actuating(self) -> bool:
        return self.online and self.running and not self.errored

    def _set_running(self, value: bool) -> None:
        if value != self.running:
            self.running = value
            self._last_run_change = time.monotonic()

    def step_state(self) -> None:
        # Fault onset while healthy / recovery while faulted.
        if not self.errored and random.random() < FAULT_ONSET_P:
            self.errored = True
            self._set_running(False)
            self.error_reason = random.choice(self.FAULTS)
        elif self.errored and random.random() < FAULT_CLEAR_P:
            self.errored = False
            self.error_reason = None
            self._set_running(True)

        # While healthy, cycle the ram stroke on/off — but only once the press
        # has held its current running state for at least PRESS_RUN_COOLDOWN_S.
        cooled_down = time.monotonic() - self._last_run_change >= PRESS_RUN_COOLDOWN_S
        if not self.errored and cooled_down and random.random() < 0.2:
            self._set_running(not self.running)

        # Force tracks whether the ram is currently actuating.
        target = random.uniform(3000, 8000) if self.actuating else 0.0
        self._force += (target - self._force) * 0.4 + random.uniform(-50, 50)
        self._force = max(0.0, self._force)

    def actuation_payload(self) -> str:
        return json.dumps({"value": self.actuating, "unit": "bool", "ts": now_iso()})

    def force_payload(self) -> str:
        return json.dumps({"value": round(self._force), "unit": "N", "ts": now_iso()})

    def status_payload(self) -> str:
        if self.errored:
            status = "Error"
        elif self.online:
            status = "Online"
        else:
            status = "Offline"
        return json.dumps(
            {
                "status": status,
                "online": self.online,
                "running": self.running,
                "errored": self.errored,
                "errorReason": self.error_reason,
                "ts": now_iso(),
            }
        )


# --------------------------------------------------------------------------- #
# Sensor factories
# --------------------------------------------------------------------------- #


def temperature(base=22.0, metric="temperature") -> Sensor:
    return Sensor(metric, "degC", base, base - 6, base + 6, 0.3)


def humidity(base=45.0) -> Sensor:
    return Sensor("humidity", "%", base, 20, 80, 1.0)


def pm25(base=8.0) -> Sensor:
    return Sensor("air_quality_pm25", "ug/m3", base, 0, 60, 1.0)


def capacity(base=70.0) -> Sensor:
    return Sensor("capacity", "%", base, 30, 100, 1.5)


# --------------------------------------------------------------------------- #
# Area definitions — only the areas world.ts binds telemetry to
# --------------------------------------------------------------------------- #


@dataclass
class AreaSim:
    name: str
    sensors: list = field(default_factory=list)
    equipment: list[Equipment] = field(default_factory=list)


def build_areas() -> list[AreaSim]:
    return [
        AreaSim(
            "Factory",
            sensors=[
                temperature(24),
                Sensor("power", "kW", 12, 4, 30, 1.2),
                IntSensor("output", "units/h", 320, 180, 420, 15, precision=0),
            ],
            equipment=[
                # Painting machine: one paint color + three bath temperatures.
                Equipment(
                    "painter",
                    sensors=[
                        ChoiceSensor(
                            "color",
                            ["Red", "Blue", "Green", "Yellow", "White", "Black"],
                        ),
                        temperature(24, "temperature0"),
                        temperature(25, "temperature1"),
                        temperature(23, "temperature2"),
                    ],
                ),
                # Five presses (press0..press4) matching world.ts's index-based topics.
                *[Press(f"press{i}") for i in range(5)],
            ],
        ),
        AreaSim("Warehouse 1", sensors=[capacity(78), humidity(50)]),
        AreaSim("Lab 1", sensors=[temperature(21), pm25(6)]),
    ]


# --------------------------------------------------------------------------- #
# MQTT plumbing
# --------------------------------------------------------------------------- #

FLOOR = "floor-0"
STATUS_TOPIC = f"{TOPIC_ROOT}/status"


def make_client() -> mqtt.Client:
    # paho-mqtt 2.x requires an explicit callback API version; fall back for 1.x.
    try:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id=CLIENT_ID
        )
    except (AttributeError, TypeError):
        client = mqtt.Client(client_id=CLIENT_ID)  # type: ignore[call-arg]

    if USERNAME:
        client.username_pw_set(USERNAME, PASSWORD)

    client.will_set(
        STATUS_TOPIC,
        json.dumps({"status": "offline", "ts": now_iso()}),
        qos=1,
        retain=True,
    )

    def on_connect(c, _userdata, _flags, reason_code, _props=None):
        print(f"[mqtt] connected to {BROKER_HOST}:{BROKER_PORT} (rc={reason_code})")
        c.publish(
            STATUS_TOPIC,
            json.dumps({"status": "online", "ts": now_iso()}),
            qos=1,
            retain=True,
        )

    def on_disconnect(_c, _userdata, *args):
        print("[mqtt] disconnected")

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    return client


def publish_sweep(client: mqtt.Client, areas: list[AreaSim]) -> int:
    count = 0
    for area in areas:
        base = f"{TOPIC_ROOT}/{FLOOR}/{slug(area.name)}"

        for sensor in area.sensors:
            client.publish(f"{base}/{sensor.metric}", sensor.payload(), qos=QOS)
            count += 1

        for eq in area.equipment:
            eq_base = f"{base}/equipments/{eq.slug}"

            if isinstance(eq, Press):
                eq.step_state()
                # status is retained so a late-joining client sees current state.
                client.publish(f"{eq_base}/status", eq.status_payload(), qos=QOS, retain=True)
                client.publish(f"{eq_base}/actuation", eq.actuation_payload(), qos=QOS)
                client.publish(f"{eq_base}/force", eq.force_payload(), qos=QOS)
                count += 3
            else:
                for sensor in eq.sensors:
                    client.publish(f"{eq_base}/{sensor.metric}", sensor.payload(), qos=QOS)
                    count += 1
    return count


# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #


def main() -> None:
    areas = build_areas()
    client = make_client()

    running = True

    def stop(_signum, _frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    client.connect(BROKER_HOST, BROKER_PORT, KEEPALIVE)
    client.loop_start()

    n_sensors = sum(len(a.sensors) for a in areas)
    n_equipment = sum(len(a.equipment) for a in areas)
    print(
        f"[sim] Factory / Floor 0 — {len(areas)} areas, "
        f"{n_sensors} area sensors, {n_equipment} machines. "
        f"Publishing every {PUBLISH_INTERVAL_S}s. Ctrl-C to stop."
    )

    try:
        while running:
            published = publish_sweep(client, areas)
            print(f"[sim] {now_iso()} — published {published} messages")
            # Sleep in small slices so Ctrl-C is responsive.
            slept = 0.0
            while running and slept < PUBLISH_INTERVAL_S:
                time.sleep(0.1)
                slept += 0.1
    finally:
        client.publish(
            STATUS_TOPIC,
            json.dumps({"status": "offline", "ts": now_iso()}),
            qos=1,
            retain=True,
        )
        client.loop_stop()
        client.disconnect()
        print("\n[sim] stopped, broker notified offline.")


if __name__ == "__main__":
    main()
