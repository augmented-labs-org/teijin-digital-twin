#!/usr/bin/env python3
"""
Simulated Teijin Leça site -> Coreflux MQTT broker.

Publishes the signal set documented in teijin-machine-signals.md — and nothing
else. Signal names are the PLC tag names, verbatim, so a topic maps 1:1 onto a
row of that document:

    PHP 1250 (compression press)                42 signals
      ├─ PLC A  Siemens S7-1500  10.205.72.20   11 signals
      ├─ PLC B  Siemens S7-1200  10.205.72.28   11 signals
      └─ Energy Shelly 3EM                      20 signals
    Pintura Clássica (painting line)            64 signals
      ├─ PLC    Siemens S7-1200  10.205.72.10   44 signals
      └─ Energy Shelly 3EM                      20 signals

NB: the document's own totals say the painting PLC has 45 signals (65 / 107
overall), but its table lists 44 rows — only Bath 1 has a Ph signal, baths 2
and 3 do not. The tables are taken as authoritative here, so this publishes
44 / 64 / 106. If a 45th painting signal exists, it is missing from the table.

Topic layout:
    teijin/leca/<machine>/<source>/<Signal_Name>
    teijin/leca/<machine>/status            (retained, machine state object)
    teijin/status                           (retained, LWT for this simulator)

    e.g. teijin/leca/php-1250/plc-a/Movable_Platen_Position
         teijin/leca/php-1250/energy/Total_Active_Power
         teijin/leca/pintura-classica/plc/Bath_1_Temperature

Payload (JSON), matching tools/factory.py:
    {"value": 118.4, "unit": "bar", "ts": "2026-07-28T15:04:05.123456+00:00"}

The `status` object matches what apps/web/src/impl.ts already interprets for a
press, so a machine can be wired to the 3D view without a new payload shape:
    {"status": "Online", "online": true, "running": true, "errored": false,
     "errorReason": null, "ts": ...}

Signals are not independent random walks — they are read off a physical model,
so they tell one coherent story:

  * PHP 1250 runs a real molding cycle (load charge -> close -> squeeze & cure
    -> open -> eject). Pressure, platen position/speed/state, the three timers
    and Part_Counter all come from that one state machine, and the recipe of
    the loaded product sets Target_Pressure / Target_Time / platen setpoints /
    Theoretical_Cycle_Time. Mold temperatures dip when a cold charge is loaded
    and recover under compression.
  * Pintura Clássica alternates running / downtime. Line_Speed, the dryer and
    the energy draw follow that, Machine_State and Downtime are complementary,
    and Alarm_2 is *derived* from a bath reading actually leaving its
    Min/Max band rather than being rolled at random.
  * Both Shelly 3EM meters are driven by their machine's instantaneous load:
    per-phase active power sums to Total_Active_Power, apparent power is
    active/PF, and current is apparent/voltage.

Movable_Platen_State (INT) enum:
    0 = stopped/holding   1 = closing   2 = pressing (clamped)   3 = opening

Min/Max signals are configuration limits (the accepted band for the reading
beside them), so they are constants republished every sweep — that is what the
PLC exposes.

Run:
    pip install paho-mqtt
    python3 teijin.py
"""

from __future__ import annotations

import json
import math
import random
import signal as signal_module
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

CLIENT_ID = "teijin-leca-simulator"
TOPIC_ROOT = "teijin"
SITE = "leca"
PUBLISH_INTERVAL_S = 1.0        # seconds between full sweeps (1s resolves the press cycle)
QOS = 0

# Probability, per machine per sweep, of a fault appearing / clearing.
FAULT_ONSET_P = 0.004
FAULT_CLEAR_P = 0.05

# Pintura Clássica: chance per sweep of going down / coming back up.
LINE_STOP_P = 0.004
LINE_START_P = 0.06


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def payload(value: object, unit: str) -> str:
    return json.dumps({"value": value, "unit": unit, "ts": now_iso()})


def approach(value: float, target: float, tau: float, dt: float, noise: float = 0.0) -> float:
    """First-order lag toward `target` with time constant `tau`, plus jitter."""
    value += (target - value) * (1.0 - math.exp(-dt / max(tau, 1e-6)))
    if noise:
        value += random.uniform(-noise, noise)
    return value


# --------------------------------------------------------------------------- #
# Shelly 3EM energy meter — 20 signals, driven by the machine's load
# --------------------------------------------------------------------------- #


@dataclass
class EnergyMeter:
    """
    A three-phase energy meter. `feed(kw, dt)` hands it the machine's current
    active-power demand; every published signal is derived from that, so the
    per-phase numbers add up to the totals and the electrical identities
    (S = P / PF, I = S / V) hold.
    """

    nominal_voltage: float = 230.0
    # Fixed per-phase load imbalance — a real installation is never perfectly balanced.
    share: tuple[float, float, float] = (0.35, 0.33, 0.32)

    def __post_init__(self) -> None:
        self.active = [0.0, 0.0, 0.0]           # kW
        self.voltage = [self.nominal_voltage] * 3
        self.power_factor = [0.90, 0.90, 0.90]
        self.frequency = [50.0] * 3
        self.apparent = [0.0, 0.0, 0.0]         # kVA
        self.current = [0.0, 0.0, 0.0]          # A

    def feed(self, kw: float, dt: float) -> None:
        kw = max(0.0, kw)

        for i in range(3):
            target = kw * self.share[i]
            self.active[i] = max(0.0, approach(self.active[i], target, 1.5, dt, noise=0.04))
            self.voltage[i] = approach(self.voltage[i], self.nominal_voltage + (i - 1) * 0.7, 4.0, dt, noise=0.35)
            self.frequency[i] = approach(self.frequency[i], 50.0, 6.0, dt, noise=0.015)

            # A lightly loaded machine has a poor power factor; it improves as
            # the motors take up load.
            load_ratio = min(1.0, self.active[i] / max(1.0, 25.0 * self.share[i] * 3))
            pf_target = 0.72 + 0.22 * load_ratio
            self.power_factor[i] = min(0.99, approach(self.power_factor[i], pf_target, 3.0, dt, noise=0.004))

            self.apparent[i] = self.active[i] / self.power_factor[i]
            self.current[i] = self.apparent[i] * 1000.0 / max(1.0, self.voltage[i])

    def signals(self) -> dict[str, tuple[object, str]]:
        phases = ("A", "B", "C")
        out: dict[str, tuple[object, str]] = {
            "Total_Active_Power": (round(sum(self.active), 3), "kW"),
            "Total_Current": (round(sum(self.current), 2), "A"),
        }
        for i, p in enumerate(phases):
            out[f"Phase_{p}_Active_Power"] = (round(self.active[i], 3), "kW")
        for i, p in enumerate(phases):
            out[f"Phase_{p}_Current"] = (round(self.current[i], 2), "A")
        for i, p in enumerate(phases):
            out[f"Phase_{p}_Voltage"] = (round(self.voltage[i], 1), "V")
        for i, p in enumerate(phases):
            out[f"Phase_{p}_Power_Factor"] = (round(self.power_factor[i], 3), "")
        for i, p in enumerate(phases):
            out[f"Phase_{p}_Frequency"] = (round(self.frequency[i], 2), "Hz")
        for i, p in enumerate(phases):
            out[f"Phase_{p}_Apparent_Power"] = (round(self.apparent[i], 3), "kVA")
        return out


# --------------------------------------------------------------------------- #
# Machine base
# --------------------------------------------------------------------------- #


@dataclass
class Machine:
    """A machine publishing under teijin/leca/<slug>/<source>/<Signal_Name>."""

    slug: str
    name: str

    def __post_init__(self) -> None:
        self.online = True
        self.running = True
        self.errored = False
        self.error_reason: Optional[str] = None

    def step(self, dt: float) -> None:
        raise NotImplementedError

    def sources(self) -> dict[str, dict[str, tuple[object, str]]]:
        """{source-slug: {Signal_Name: (value, unit)}}"""
        raise NotImplementedError

    def power_demand(self) -> float:
        """Active power drawn right now, in kW; feeds this machine's meter."""
        raise NotImplementedError

    def _step_fault(self, faults: list[str]) -> None:
        if not self.errored and random.random() < FAULT_ONSET_P:
            self.errored = True
            self.error_reason = random.choice(faults)
        elif self.errored and random.random() < FAULT_CLEAR_P:
            self.errored = False
            self.error_reason = None

    @property
    def status_label(self) -> str:
        if self.errored:
            return "Error"
        if not self.online:
            return "Offline"
        return "Online" if self.running else "Idle"

    def status_payload(self) -> str:
        return json.dumps(
            {
                "status": self.status_label,
                "online": self.online,
                "running": self.running,
                "errored": self.errored,
                "errorReason": self.error_reason,
                "ts": now_iso(),
            }
        )


# --------------------------------------------------------------------------- #
# PHP 1250 — compression molding press
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Recipe:
    """A product's molding recipe; drives every setpoint the PLC exposes."""

    description: str
    target_pressure: float      # bar
    target_time: float          # s of compression (squeeze + cure)
    fixed_platen_sp: tuple[float, float]      # degC, zones 1 and 2
    movable_platen_sp: tuple[float, float]    # degC, zones 1 and 2
    theoretical_cycle: float    # s, engineered cycle time
    parts_per_batch: int


RECIPES = [
    Recipe("SMC TAILGATE INNER LH", 118.0, 62.0, (148.0, 146.0), (147.0, 145.0), 92.0, 40),
    Recipe("SMC TAILGATE INNER RH", 118.0, 62.0, (148.0, 146.0), (147.0, 145.0), 92.0, 40),
    Recipe("SMC ROOF PANEL", 96.0, 52.0, (145.0, 144.0), (144.0, 143.0), 80.0, 60),
    Recipe("LFT-D BATTERY COVER", 140.0, 78.0, (152.0, 150.0), (151.0, 149.0), 112.0, 24),
    Recipe("SMC FENDER SUPPORT", 88.0, 44.0, (143.0, 142.0), (142.0, 141.0), 70.0, 80),
]

# Platen travel geometry (mm from the closed position).
PLATEN_OPEN_MM = 800.0
PLATEN_TOUCH_MM = 25.0          # charge contact — compression starts here
PLATEN_CLOSED_MM = 2.0
CLOSE_FAST_MM_S = 145.0
CLOSE_SLOW_MM_S = 14.0          # slow approach below APPROACH_MM
APPROACH_MM = 70.0
SQUEEZE_MM_S = 2.2              # creep from contact to fully closed
OPEN_MM_S = 165.0
LOAD_TIME_S = 14.0              # mold open, charge being laid up

PHASE_OPEN = 0
PHASE_CLOSING = 1
PHASE_PRESSING = 2
PHASE_OPENING = 3

PRESS_FAULTS = [
    "Hydraulic pressure low",
    "Platen thermocouple fault",
    "Ram jam",
    "Over-pressure",
    "Mold safety interlock",
]


class Php1250(Machine):
    """
    Compression press. One cycle:

        OPEN (load charge) -> CLOSING (fast, then slow approach) ->
        PRESSING (squeeze to closed, pressure ramps to Target_Pressure, cure
        for Target_Time) -> OPENING -> part ejected, Part_Counter += 1

    A fault freezes the cycle where it stands and dumps pressure until cleared.
    """

    def __init__(self) -> None:
        super().__init__(slug="php-1250", name="PHP 1250")
        self.recipe = RECIPES[0]
        self.parts_in_batch = 0
        self.part_counter = random.randint(4000, 9000)

        self.phase = PHASE_OPEN
        self.phase_elapsed = 0.0
        self.total_time = 0.0
        self.compression_time = 0.0

        self.platen = PLATEN_OPEN_MM
        self.platen_speed = 0.0
        self.pressure = 0.0

        # PLC B — heating zones settle around the recipe setpoints.
        self.fixed_platen_temp = list(self.recipe.fixed_platen_sp)
        self.movable_platen_temp = list(self.recipe.movable_platen_sp)
        self.mold_cavity_temp = self.recipe.fixed_platen_sp[0] - 4.0
        self.mold_male_temp = self.recipe.movable_platen_sp[0] - 5.0

        self._expected_total = self._plan_cycle_time()

    # -- cycle timing -------------------------------------------------------

    def _plan_cycle_time(self) -> float:
        """Expected wall time for one cycle, used for Remaining_Time."""
        fast = (PLATEN_OPEN_MM - APPROACH_MM) / CLOSE_FAST_MM_S
        slow = (APPROACH_MM - PLATEN_TOUCH_MM) / CLOSE_SLOW_MM_S
        opening = (PLATEN_OPEN_MM - PLATEN_CLOSED_MM) / OPEN_MM_S
        return LOAD_TIME_S + fast + slow + self.recipe.target_time + opening

    def _enter(self, phase: int) -> None:
        self.phase = phase
        self.phase_elapsed = 0.0

    def _finish_cycle(self) -> None:
        self.part_counter += 1
        self.parts_in_batch += 1

        if self.parts_in_batch >= self.recipe.parts_per_batch:
            self.parts_in_batch = 0
            self.recipe = random.choice([r for r in RECIPES if r is not self.recipe])

        self.total_time = 0.0
        self.compression_time = 0.0
        self._expected_total = self._plan_cycle_time()
        self._enter(PHASE_OPEN)

    # -- simulation ---------------------------------------------------------

    def step(self, dt: float) -> None:
        self._step_fault(PRESS_FAULTS)
        self.running = self.online and not self.errored

        if self.running:
            self.total_time += dt
            self.phase_elapsed += dt
            self._step_cycle(dt)
        else:
            # Faulted: everything holds position, pressure bleeds off.
            self.platen_speed = 0.0
            self.pressure = approach(self.pressure, 0.0, 4.0, dt)

        self._step_temperatures(dt)

    def _step_cycle(self, dt: float) -> None:
        if self.phase == PHASE_OPEN:
            self.platen_speed = 0.0
            self.pressure = approach(self.pressure, 0.0, 2.0, dt)
            if self.phase_elapsed >= LOAD_TIME_S:
                self._enter(PHASE_CLOSING)

        elif self.phase == PHASE_CLOSING:
            speed = CLOSE_FAST_MM_S if self.platen > APPROACH_MM else CLOSE_SLOW_MM_S
            self.platen = max(PLATEN_TOUCH_MM, self.platen - speed * dt)
            self.platen_speed = speed
            self.pressure = approach(self.pressure, 4.0, 2.0, dt)
            if self.platen <= PLATEN_TOUCH_MM:
                self._enter(PHASE_PRESSING)

        elif self.phase == PHASE_PRESSING:
            self.compression_time += dt
            if self.platen > PLATEN_CLOSED_MM:
                self.platen = max(PLATEN_CLOSED_MM, self.platen - SQUEEZE_MM_S * dt)
                self.platen_speed = SQUEEZE_MM_S
            else:
                self.platen_speed = 0.0
            self.pressure = approach(self.pressure, self.recipe.target_pressure, 3.0, dt, noise=0.4)
            if self.compression_time >= self.recipe.target_time:
                self._enter(PHASE_OPENING)

        elif self.phase == PHASE_OPENING:
            self.pressure = approach(self.pressure, 0.0, 1.2, dt)
            self.platen = min(PLATEN_OPEN_MM, self.platen + OPEN_MM_S * dt)
            self.platen_speed = OPEN_MM_S
            if self.platen >= PLATEN_OPEN_MM:
                self._finish_cycle()

    def _step_temperatures(self, dt: float) -> None:
        heat_ok = self.online and self.error_reason != "Platen thermocouple fault"

        for i in range(2):
            sp_f = self.recipe.fixed_platen_sp[i] if heat_ok else 120.0
            sp_m = self.recipe.movable_platen_sp[i] if heat_ok else 120.0
            self.fixed_platen_temp[i] = approach(self.fixed_platen_temp[i], sp_f, 45.0, dt, noise=0.12)
            self.movable_platen_temp[i] = approach(self.movable_platen_temp[i], sp_m, 45.0, dt, noise=0.12)

        # A cold charge sits on the mold while it is open and during closing;
        # the mold surfaces recover once the platens are clamped onto it.
        cooling = self.phase in (PHASE_OPEN, PHASE_CLOSING) and self.running
        cavity_target = self.fixed_platen_temp[0] - (11.0 if cooling else 3.0)
        male_target = self.movable_platen_temp[0] - (9.0 if cooling else 4.0)
        self.mold_cavity_temp = approach(self.mold_cavity_temp, cavity_target, 12.0, dt, noise=0.15)
        self.mold_male_temp = approach(self.mold_male_temp, male_target, 12.0, dt, noise=0.15)

    def power_demand(self) -> float:
        """kW drawn right now: platen heaters + the hydraulic pack."""
        # Heaters modulate to hold setpoint; they are most of the standby draw.
        heater_error = sum(
            max(0.0, sp - t)
            for sp, t in zip(
                list(self.recipe.fixed_platen_sp) + list(self.recipe.movable_platen_sp),
                self.fixed_platen_temp + self.movable_platen_temp,
            )
        )
        heaters = 7.0 + min(18.0, heater_error * 6.0)

        if not self.running:
            hydraulics = 1.5
        elif self.phase == PHASE_OPEN:
            hydraulics = 3.0
        elif self.phase == PHASE_CLOSING:
            hydraulics = 26.0 if self.platen > APPROACH_MM else 14.0
        elif self.phase == PHASE_PRESSING:
            # Big draw while the ram squeezes, then just pressure top-up during cure.
            squeezing = self.platen > PLATEN_CLOSED_MM
            hydraulics = 48.0 if squeezing else 9.0
        else:
            hydraulics = 20.0

        return heaters + hydraulics + random.uniform(-0.6, 0.6)

    def sources(self) -> dict[str, dict[str, tuple[object, str]]]:
        remaining = max(0.0, self._expected_total - self.total_time)

        plc_a: dict[str, tuple[object, str]] = {
            "Product_Description": (self.recipe.description, ""),
            "Part_Counter": (self.part_counter, "parts"),
            "Compression_Time": (round(self.compression_time, 1), "s"),
            "Total_Time": (round(self.total_time, 1), "s"),
            "Remaining_Time": (round(remaining, 1), "s"),
            "Pressure": (round(self.pressure, 2), "bar"),
            "Movable_Platen_Position": (round(self.platen, 1), "mm"),
            "Movable_Platen_State": (int(self.phase if self.running else PHASE_OPEN), ""),
            "Speed": (round(self.platen_speed, 1), "mm/s"),
            "Target_Pressure": (round(self.recipe.target_pressure, 1), "bar"),
            "Target_Time": (round(self.recipe.target_time, 1), "s"),
        }

        plc_b: dict[str, tuple[object, str]] = {
            "Fixed_Platen_Temperature_1": (round(self.fixed_platen_temp[0], 2), "degC"),
            "Fixed_Platen_Temperature_1_Setpoint": (self.recipe.fixed_platen_sp[0], "degC"),
            "Fixed_Platen_Temperature_2": (round(self.fixed_platen_temp[1], 2), "degC"),
            "Fixed_Platen_Temperature_2_Setpoint": (self.recipe.fixed_platen_sp[1], "degC"),
            "Mold_Cavity_Temperature": (round(self.mold_cavity_temp, 2), "degC"),
            "Mold_Male_Temperature": (round(self.mold_male_temp, 2), "degC"),
            "Movable_Platen_Temperature_1": (round(self.movable_platen_temp[0], 2), "degC"),
            "Movable_Platen_Temperature_1_Setpoint": (self.recipe.movable_platen_sp[0], "degC"),
            "Movable_Platen_Temperature_2": (round(self.movable_platen_temp[1], 2), "degC"),
            "Movable_Platen_Temperature_2_Setpoint": (self.recipe.movable_platen_sp[1], "degC"),
            "Theoretical_Cycle_Time": (self.recipe.theoretical_cycle, "s"),
        }

        return {"plc-a": plc_a, "plc-b": plc_b}


# --------------------------------------------------------------------------- #
# Pintura Clássica — classic painting line
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Band:
    """A reading with the Min/Max configuration limits published beside it."""

    setpoint: float
    low: float
    high: float


# Pre-treatment baths: 1 degrease (alkaline, hence the pH probe), 2 rinse,
# 3 conversion coating.
BATHS = [
    {"temperature": Band(58.0, 52.0, 64.0), "pressure": Band(2.4, 1.8, 3.0)},
    {"temperature": Band(34.0, 28.0, 40.0), "pressure": Band(2.0, 1.5, 2.6)},
    {"temperature": Band(48.0, 43.0, 54.0), "pressure": Band(2.2, 1.7, 2.8)},
]

CABINS = [
    {"temperature": Band(23.0, 20.0, 26.0), "humidity": Band(65.0, 55.0, 75.0)},
    {"temperature": Band(23.5, 20.0, 26.0), "humidity": Band(64.0, 55.0, 75.0)},
]

PAINT_ROOM = {"temperature": Band(22.0, 19.0, 25.0), "humidity": Band(60.0, 50.0, 70.0)}

LINE_SPEED_M_MIN = 3.6
DRYER_RUN_C = 165.0
DRYER_IDLE_C = 82.0

BATH_PH = Band(10.8, 10.2, 11.4)
PH_DRIFT_PER_S = 0.0022     # neutralisation by incoming parts, while running
PH_DOSE_PER_S = 0.0060      # caustic dosing pump, once it cuts in

# Alarm_1: process/mechanical. Alarm_2: derived from a bath out of band.
# Alarm_3: utilities. 0 means no active alarm.
ALARM_1_CODES = [205, 402, 118, 331]        # line jam, conveyor drive, hanger, oven damper
ALARM_2_TEMPERATURE = 101
ALARM_2_PRESSURE = 102
ALARM_2_PH = 103
ALARM_3_CODES = [510, 522]                  # compressed-air low, exhaust fan

LINE_FAULTS = [
    "Conveyor drive fault",
    "Bath circulation pump fault",
    "Booth exhaust pressure low",
    "Oven burner lockout",
]


class PinturaClassica(Machine):
    """
    Classic painting line: pre-treatment baths -> dryer -> paint booths.

    Alternates running / downtime; Machine_State and Downtime are the two sides
    of that. While down the line stops, the dryer cools and the baths drift off
    setpoint, which is what eventually trips Alarm_2 through the same Min/Max
    limits the PLC publishes.
    """

    def __init__(self) -> None:
        super().__init__(slug="pintura-classica", name="Pintura Clássica")
        self.line_speed = LINE_SPEED_M_MIN
        self.dryer_temp = DRYER_RUN_C
        self.bath_temp = [b["temperature"].setpoint for b in BATHS]
        self.bath_pressure = [b["pressure"].setpoint for b in BATHS]
        self.bath_ph = BATH_PH.setpoint
        self._dosing = False
        self.cabin_temp = [c["temperature"].setpoint for c in CABINS]
        self.cabin_humidity = [c["humidity"].setpoint for c in CABINS]
        self.room_temp = PAINT_ROOM["temperature"].setpoint
        self.room_humidity = PAINT_ROOM["humidity"].setpoint
        self.alarm_1 = 0
        self.alarm_3 = 0

    def step(self, dt: float) -> None:
        self._step_fault(LINE_FAULTS)

        # Planned/unplanned stops on top of hard faults.
        if self.running and random.random() < LINE_STOP_P:
            self.running = False
        elif not self.running and not self.errored and random.random() < LINE_START_P:
            self.running = True
        if self.errored:
            self.running = False

        self.line_speed = approach(
            self.line_speed,
            LINE_SPEED_M_MIN if self.running else 0.0,
            2.5,
            dt,
            noise=0.01 if self.running else 0.0,
        )

        # Dryer and baths hold setpoint while the line runs and drift while it
        # is stopped (burners and heaters throttle back).
        self.dryer_temp = approach(
            self.dryer_temp, DRYER_RUN_C if self.running else DRYER_IDLE_C, 90.0, dt, noise=0.5
        )

        # Baths keep circulating and stay heated through a line stop — the
        # chemistry has to stay homogeneous and at temperature, so a short stop
        # must not trip Alarm_2. Only a circulation-pump fault drops a bath out
        # of its published band.
        pump_fault = self.errored and self.error_reason == "Bath circulation pump fault"
        for i, bath in enumerate(BATHS):
            temp_band = bath["temperature"]
            press_band = bath["pressure"]
            temp_sp = temp_band.setpoint - (0.0 if self.running else 2.5)
            if pump_fault:
                press_sp = 0.3
            elif self.running:
                press_sp = press_band.setpoint
            else:
                press_sp = press_band.setpoint - 0.3
            self.bath_temp[i] = approach(self.bath_temp[i], temp_sp, 60.0, dt, noise=0.08)
            self.bath_pressure[i] = max(
                0.0, approach(self.bath_pressure[i], press_sp, 8.0, dt, noise=0.02)
            )

        # Bath 1 chemistry: the alkaline degrease is neutralised by the parts it
        # cleans, so pH falls while the line runs until the caustic dosing pump
        # cuts in and brings it back over setpoint — a slow sawtooth, not a walk.
        if self.running:
            self.bath_ph -= PH_DRIFT_PER_S * dt
        if self.bath_ph <= BATH_PH.low + 0.15:
            self._dosing = True
        elif self.bath_ph >= BATH_PH.setpoint + 0.15:
            self._dosing = False
        if self._dosing:
            self.bath_ph += PH_DOSE_PER_S * dt
        self.bath_ph += random.uniform(-0.004, 0.004)

        # Booths are climate-controlled; solvent load and the dryer push them up.
        for i, cabin in enumerate(CABINS):
            t_band = cabin["temperature"]
            h_band = cabin["humidity"]
            self.cabin_temp[i] = approach(
                self.cabin_temp[i], t_band.setpoint + (0.8 if self.running else -0.4), 120.0, dt, noise=0.05
            )
            self.cabin_humidity[i] = approach(
                self.cabin_humidity[i], h_band.setpoint + (1.5 if self.running else -1.0), 150.0, dt, noise=0.15
            )

        self.room_temp = approach(self.room_temp, PAINT_ROOM["temperature"].setpoint, 200.0, dt, noise=0.04)
        self.room_humidity = approach(
            self.room_humidity, PAINT_ROOM["humidity"].setpoint, 220.0, dt, noise=0.12
        )

        self._step_alarms()

    def _step_alarms(self) -> None:
        # Alarm_1 follows the hard fault; otherwise it can trip on its own and
        # is acknowledged after a while.
        if self.errored:
            if self.alarm_1 == 0:
                self.alarm_1 = random.choice(ALARM_1_CODES)
        elif self.alarm_1 != 0:
            if random.random() < 0.15:
                self.alarm_1 = 0
        elif random.random() < 0.003:
            self.alarm_1 = random.choice(ALARM_1_CODES)

        if self.alarm_3 != 0 and random.random() < 0.1:
            self.alarm_3 = 0
        elif self.alarm_3 == 0 and random.random() < 0.002:
            self.alarm_3 = random.choice(ALARM_3_CODES)

    def _alarm_2(self) -> int:
        """Derived: first bath reading found outside its published Min/Max band."""
        for i, bath in enumerate(BATHS):
            band = bath["temperature"]
            if not band.low <= self.bath_temp[i] <= band.high:
                return ALARM_2_TEMPERATURE
        for i, bath in enumerate(BATHS):
            band = bath["pressure"]
            if not band.low <= self.bath_pressure[i] <= band.high:
                return ALARM_2_PRESSURE
        if not BATH_PH.low <= self.bath_ph <= BATH_PH.high:
            return ALARM_2_PH
        return 0

    def power_demand(self) -> float:
        """kW: bath heaters + dryer burner fans + booth HVAC + conveyor."""
        dryer = 18.0 + 0.22 * max(0.0, self.dryer_temp - 20.0)
        baths = sum(4.0 + max(0.0, b["temperature"].setpoint - t) * 1.2 for b, t in zip(BATHS, self.bath_temp))
        hvac = 22.0
        conveyor = 6.5 * (self.line_speed / LINE_SPEED_M_MIN)
        pumps = 9.0 * (sum(self.bath_pressure) / sum(b["pressure"].setpoint for b in BATHS))
        return dryer + baths + hvac + conveyor + pumps + random.uniform(-0.8, 0.8)

    def sources(self) -> dict[str, dict[str, tuple[object, str]]]:
        plc: dict[str, tuple[object, str]] = {
            "Line_Speed": (round(self.line_speed, 2), "m/min"),
        }

        plc["Bath_1_Ph"] = (round(self.bath_ph, 2), "pH")

        for i, bath in enumerate(BATHS, start=1):
            press_band = bath["pressure"]
            temp_band = bath["temperature"]
            plc[f"Bath_{i}_Pressure"] = (round(self.bath_pressure[i - 1], 2), "bar")
            plc[f"Bath_{i}_Pressure_Min"] = (press_band.low, "bar")
            plc[f"Bath_{i}_Pressure_Max"] = (press_band.high, "bar")
            plc[f"Bath_{i}_Temperature"] = (round(self.bath_temp[i - 1], 2), "degC")
            plc[f"Bath_{i}_Temperature_Min"] = (temp_band.low, "degC")
            plc[f"Bath_{i}_Temperature_Max"] = (temp_band.high, "degC")

        plc["Dryer_Temperature"] = (round(self.dryer_temp, 2), "degC")

        for i, cabin in enumerate(CABINS, start=1):
            t_band = cabin["temperature"]
            h_band = cabin["humidity"]
            plc[f"Cabin_{i}_Temperature"] = (round(self.cabin_temp[i - 1], 2), "degC")
            plc[f"Cabin_{i}_Temperature_Min"] = (t_band.low, "degC")
            plc[f"Cabin_{i}_Temperature_Max"] = (t_band.high, "degC")
            plc[f"Cabin_{i}_Humidity"] = (round(self.cabin_humidity[i - 1], 2), "%")
            plc[f"Cabin_{i}_Humidity_Min"] = (h_band.low, "%")
            plc[f"Cabin_{i}_Humidity_Max"] = (h_band.high, "%")

        plc["Paint_Room_Temperature"] = (round(self.room_temp, 2), "degC")
        plc["Paint_Room_Temperature_Min"] = (PAINT_ROOM["temperature"].low, "degC")
        plc["Paint_Room_Temperature_Max"] = (PAINT_ROOM["temperature"].high, "degC")
        plc["Paint_Room_Humidity"] = (round(self.room_humidity, 2), "%")
        plc["Paint_Room_Humidity_Min"] = (PAINT_ROOM["humidity"].low, "%")
        plc["Paint_Room_Humidity_Max"] = (PAINT_ROOM["humidity"].high, "%")

        plc["Machine_State"] = (bool(self.running), "bool")
        plc["Downtime"] = (bool(not self.running), "bool")
        plc["Alarm_1"] = (int(self.alarm_1), "")
        plc["Alarm_2"] = (self._alarm_2(), "")
        plc["Alarm_3"] = (int(self.alarm_3), "")

        return {"plc": plc}


# --------------------------------------------------------------------------- #
# Site — machines plus their energy meters
# --------------------------------------------------------------------------- #


@dataclass
class MachineSim:
    machine: Machine
    meter: EnergyMeter = field(default_factory=EnergyMeter)

    @property
    def base(self) -> str:
        return f"{TOPIC_ROOT}/{SITE}/{self.machine.slug}"

    def step(self, dt: float) -> None:
        self.machine.step(dt)
        self.meter.feed(self.machine.power_demand(), dt)

    def signals(self) -> dict[str, dict[str, tuple[object, str]]]:
        return {**self.machine.sources(), "energy": self.meter.signals()}


def build_site() -> list[MachineSim]:
    return [
        MachineSim(Php1250()),
        MachineSim(PinturaClassica()),
    ]


# --------------------------------------------------------------------------- #
# MQTT plumbing
# --------------------------------------------------------------------------- #

STATUS_TOPIC = f"{TOPIC_ROOT}/status"


def make_client() -> mqtt.Client:
    # paho-mqtt 2.x requires an explicit callback API version; fall back for 1.x.
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=CLIENT_ID)
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


def publish_sweep(client: mqtt.Client, site: list[MachineSim]) -> int:
    count = 0
    for sim in site:
        # status is retained so a late-joining client sees current state.
        client.publish(f"{sim.base}/status", sim.machine.status_payload(), qos=QOS, retain=True)

        for source, signals in sim.signals().items():
            for name, (value, unit) in signals.items():
                client.publish(f"{sim.base}/{source}/{name}", payload(value, unit), qos=QOS)
                count += 1
    return count


# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #


def main() -> None:
    site = build_site()
    client = make_client()

    running = True

    def stop(_signum, _frame):
        nonlocal running
        running = False

    signal_module.signal(signal_module.SIGINT, stop)
    signal_module.signal(signal_module.SIGTERM, stop)

    client.connect(BROKER_HOST, BROKER_PORT, KEEPALIVE)
    client.loop_start()

    for sim in site:
        counts = {source: len(signals) for source, signals in sim.signals().items()}
        total = sum(counts.values())
        detail = ", ".join(f"{source} {n}" for source, n in counts.items())
        print(f"[sim] {sim.machine.name}: {total} signals ({detail})")

    print(
        f"[sim] Teijin {SITE.title()} — {len(site)} machines. "
        f"Publishing every {PUBLISH_INTERVAL_S}s. Ctrl-C to stop."
    )

    try:
        last = time.monotonic()
        sweep = 0
        while running:
            now = time.monotonic()
            dt = max(1e-3, now - last)
            last = now

            for sim in site:
                sim.step(dt)

            published = publish_sweep(client, site)
            sweep += 1

            # One line per machine every few sweeps — enough to see the press
            # walk through its cycle without drowning the terminal.
            if sweep % 5 == 0:
                press, line = site[0].machine, site[1].machine
                assert isinstance(press, Php1250) and isinstance(line, PinturaClassica)
                print(
                    f"[sim] {now_iso()} — {published} msgs | "
                    f"PHP1250 {press.status_label} phase={press.phase} "
                    f"pos={press.platen:6.1f}mm p={press.pressure:6.1f}bar "
                    f"part={press.part_counter} | "
                    f"Pintura {line.status_label} speed={line.line_speed:4.2f}m/min "
                    f"alarms={line.alarm_1}/{line._alarm_2()}/{line.alarm_3}"
                )

            # Sleep in small slices so Ctrl-C is responsive.
            slept = 0.0
            while running and slept < PUBLISH_INTERVAL_S:
                time.sleep(0.05)
                slept += 0.05
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
