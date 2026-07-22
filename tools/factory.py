#!/usr/bin/env python3
"""
Simulated factory -> Coreflux MQTT broker.

Mirrors the world defined in apps/web/src/core/world.ts:
    Building "Factory"
      └─ Floor 0
          ├─ 15 areas (Entrance, Warehouses, Factory, Labs, Offices, WCs, ...)
          └─ equipment inside some of the areas

Every area exposes a set of sensors appropriate to what it is, and some areas
contain equipment (machines) with their own telemetry. Each sensor/equipment
metric is published to its own MQTT topic as a small JSON payload, so it maps
cleanly onto Coreflux LOT models and any MQTT dashboard.

Topic layout:
    factory/floor-0/<area-slug>/<metric>
    factory/floor-0/<area-slug>/equipment/<equipment-slug>/<metric>
    factory/floor-0/<area-slug>/equipment/<equipment-slug>/status   (retained)
    factory/status                                                   (retained, LWT)

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

# Probability, per equipment per sweep, of a fault appearing / clearing.
FAULT_ONSET_P = 0.01
FAULT_CLEAR_P = 0.25


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
    """Integer-valued sensor (occupancy counts, output/h, ...)."""

    def tick(self) -> float:
        super().tick()
        self.value = round(self.value)
        return int(self.value)


@dataclass
class BoolSensor:
    """A door/switch style sensor that flips occasionally."""

    metric: str
    value: bool
    flip_p: float = 0.15
    unit: str = "bool"

    def payload(self) -> str:
        if random.random() < self.flip_p:
            self.value = not self.value
        return json.dumps({"value": self.value, "unit": self.unit, "ts": now_iso()})


# --------------------------------------------------------------------------- #
# Simulated equipment
# --------------------------------------------------------------------------- #


@dataclass
class Equipment:
    """
    A machine with online/running/error state plus running telemetry.
    Matches the Equipment model in apps/web/src/core/building/equipment.ts.
    """

    name: str
    online: bool = True
    running: bool = True
    errored: bool = False
    error_reason: Optional[str] = None
    faults: list[str] = field(default_factory=list)
    sensors: list[Sensor] = field(default_factory=list)

    def step_state(self) -> None:
        # Occasionally toggle running when healthy.
        if not self.errored and random.random() < 0.05:
            self.running = not self.running

        # Fault onset / recovery.
        if not self.errored and random.random() < FAULT_ONSET_P:
            self.errored = True
            self.running = False
            self.error_reason = random.choice(
                self.faults or ["Unexpected fault"]
            )
        elif self.errored and random.random() < FAULT_CLEAR_P:
            self.errored = False
            self.error_reason = None
            self.running = True

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
# Sensor / equipment factories (realistic per-area kit)
# --------------------------------------------------------------------------- #


def temperature(base=22.0) -> Sensor:
    return Sensor("temperature", "degC", base, base - 6, base + 6, 0.3)


def humidity(base=45.0) -> Sensor:
    return Sensor("humidity", "%", base, 20, 80, 1.0)


def co2(base=600.0) -> Sensor:
    return Sensor("co2", "ppm", base, 400, 1500, 25, precision=0)


def pm25(base=8.0) -> Sensor:
    return Sensor("air_quality_pm25", "ug/m3", base, 0, 60, 1.0)


def capacity(base=70.0) -> Sensor:
    return Sensor("capacity", "%", base, 30, 100, 1.5)


def occupancy(base=1) -> IntSensor:
    return IntSensor("occupancy", "count", base, 0, 12, 2, precision=0)


def machine(name: str, faults: list[str]) -> Equipment:
    return Equipment(
        name=name,
        faults=faults,
        sensors=[
            Sensor("motor_current", "A", 12.0, 0, 40, 2.0),
            Sensor("vibration", "mm/s", 1.5, 0, 12, 0.4, precision=2),
            temperature(38.0),
        ],
    )


# --------------------------------------------------------------------------- #
# Area definitions — one entry per area in world.ts
# --------------------------------------------------------------------------- #


@dataclass
class AreaSim:
    name: str
    sensors: list = field(default_factory=list)
    equipment: list[Equipment] = field(default_factory=list)


def build_areas() -> list[AreaSim]:
    return [
        AreaSim("Entrance", [temperature(23), occupancy(2),
                             BoolSensor("door_open", False)]),
        AreaSim("Warehouse 1", [temperature(19), humidity(50), capacity(78)],
                [machine("Forklift-01", ["Battery fault", "Hydraulic pressure low"])]),
        AreaSim("Warehouse 2", [temperature(19), humidity(48), capacity(64)],
                [machine("Forklift-02", ["Battery fault", "Motor overheat"])]),
        AreaSim("Factory",
                [temperature(24),
                 Sensor("power", "kW", 12, 4, 30, 1.2),
                 IntSensor("output", "units/h", 320, 180, 420, 15, precision=0),
                 Sensor("noise", "dB", 78, 60, 95, 2.0)],
                [machine("CNC-Mill-01", ["Spindle overload", "Coolant low", "Tool wear limit"]),
                 machine("Conveyor-01", ["Belt jam", "Drive motor fault"]),
                 machine("Robot-Arm-01", ["Servo fault", "Position error", "E-stop triggered"]),
                 machine("Hydraulic-Press-01", ["Seal leak", "Over-pressure"])]),
        AreaSim("Lab 1", [temperature(21), humidity(40), pm25(6), co2(550)],
                [machine("Fume-Hood-01", ["Airflow below threshold"])]),
        AreaSim("Lab 2", [temperature(21), humidity(42), pm25(7)],
                [machine("Centrifuge-01", ["Imbalance detected", "Lid interlock"])]),
        AreaSim("Lab 3", [temperature(21), humidity(41), pm25(7)]),
        AreaSim("dressing room", [temperature(23), occupancy(1)]),
        AreaSim("Pantry", [temperature(22), humidity(46),
                           Sensor("fridge_temp", "degC", 4, 1, 8, 0.3)],
                [machine("Refrigerator-01", ["Compressor fault", "Door left open"])]),
        AreaSim("WC 1", [humidity(55), occupancy(0)]),
        AreaSim("WC 2", [humidity(55), occupancy(0)]),
        AreaSim("Office 1", [temperature(23), humidity(44), co2(650), occupancy(3)]),
        AreaSim("Office 2", [temperature(23), humidity(44), co2(620), occupancy(2)]),
        AreaSim("Office 3", [temperature(23), humidity(43), co2(700), occupancy(4)]),
        AreaSim("Office 4", [temperature(23), humidity(45), co2(580), occupancy(1)]),
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
            eq.step_state()
            eq_base = f"{base}/equipment/{slug(eq.name)}"
            client.publish(f"{eq_base}/status", eq.status_payload(), qos=QOS, retain=True)
            count += 1
            # Telemetry only flows while the machine is actually running.
            if eq.running and not eq.errored:
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
