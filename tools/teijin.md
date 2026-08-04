# teijin.py — simulated Teijin Leça site

Publishes the signal set from `teijin-machine-signals.md` to the Coreflux MQTT
broker, and nothing else. Two machines, 106 signals per sweep, one sweep per
second.

```
pip install paho-mqtt
python3 teijin.py          # broker/interval are constants at the top of the file
```

## Topics & payload

```
teijin/leca/<machine>/<source>/<Signal_Name>
teijin/leca/<machine>/status     retained: {status, online, running, errored, errorReason, ts}
teijin/status                    retained, LWT: {status, ts}
```

Signal names are the PLC tag names verbatim, so a topic maps 1:1 onto a row of
`teijin-machine-signals.md`. Values are JSON:

```json
{"value": 118.4, "unit": "bar", "ts": "2026-07-28T15:04:05.123456+00:00"}
```

PLC types are honoured: `Part_Counter`/`Movable_Platen_State`/`Alarm_*` publish
ints, `Machine_State`/`Downtime` publish bools, `Product_Description` a string,
everything else a float.

## Not random walks

Every signal is read off a physical model, so they agree with each other:

- **PHP 1250** runs a molding cycle — load charge → close (fast, then slow
  approach) → squeeze & cure → open → `Part_Counter++`. Pressure, platen
  position/speed/state and all three timers come from that one state machine.
  The loaded product's recipe sets `Target_Pressure`, `Target_Time`, the platen
  setpoints and `Theoretical_Cycle_Time`; the product changes every batch. Mold
  temperatures dip when a cold charge sits on the open mold and recover under
  clamp. A fault freezes the cycle and dumps pressure.
- **Pintura Clássica** alternates running/downtime — `Machine_State` and
  `Downtime` are the two sides of that, and `Line_Speed`, the dryer and the
  power draw follow it. `Alarm_2` is *derived* from a bath reading actually
  leaving its published Min/Max band, not rolled at random; baths keep
  circulating through short stops, so only a pump fault trips it. `Bath_1_Ph`
  is a dosing sawtooth (neutralised by incoming parts, caustic pump cuts in).
- **Both Shelly 3EM meters** are driven by their machine's instantaneous load,
  with the electrical identities holding: per-phase active power sums to
  `Total_Active_Power`, apparent = active / PF, current = apparent / voltage.

`*_Min` / `*_Max` are configuration limits — constants republished every sweep,
which is what the PLC exposes.

## Signals generated

### PHP 1250 — `teijin/leca/php-1250` (42)

**`plc-a`** (11) — Siemens S7-1500, `10.205.72.20`

| Signal | Type | Unit | Behaviour |
|---|---|---|---|
| Product_Description | STRING | — | current recipe, changes per batch |
| Part_Counter | INT | parts | +1 per completed cycle |
| Compression_Time | REAL | s | accumulates during the squeeze/cure phase |
| Total_Time | REAL | s | elapsed in the current cycle |
| Remaining_Time | REAL | s | countdown to planned cycle end |
| Pressure | REAL | bar | ramps to `Target_Pressure`, held, then dumped |
| Movable_Platen_Position | REAL | mm | 800 open → 2 closed |
| Movable_Platen_State | INT | — | 0 stopped · 1 closing · 2 pressing · 3 opening |
| Speed | REAL | mm/s | platen travel speed (0 while holding) |
| Target_Pressure | REAL | bar | recipe setpoint |
| Target_Time | REAL | s | recipe setpoint |

**`plc-b`** (11) — Siemens S7-1200, `10.205.72.28`

| Signal | Type | Unit | Behaviour |
|---|---|---|---|
| Fixed_Platen_Temperature_1 / _2 | REAL | degC | heated zones tracking their setpoints |
| Fixed_Platen_Temperature_1_Setpoint / _2_Setpoint | REAL | degC | from the recipe |
| Movable_Platen_Temperature_1 / _2 | REAL | degC | heated zones tracking their setpoints |
| Movable_Platen_Temperature_1_Setpoint / _2_Setpoint | REAL | degC | from the recipe |
| Mold_Cavity_Temperature | REAL | degC | dips on charge load, recovers under clamp |
| Mold_Male_Temperature | REAL | degC | as above |
| Theoretical_Cycle_Time | REAL | s | engineered cycle time for the recipe |

**`energy`** (20) — Shelly 3EM. Typical range 5–75 kW across the cycle.

### Pintura Clássica — `teijin/leca/pintura-classica` (64)

**`plc`** (44) — Siemens S7-1200, `10.205.72.10`

| Signal | Type | Unit | Behaviour |
|---|---|---|---|
| Line_Speed | REAL | m/min | 3.6 running, 0 stopped |
| Bath_1_Ph | REAL | pH | sawtooth ~10.35–10.95 (drift + caustic dosing) |
| Bath_{1,2,3}_Temperature | REAL | degC | ~58 / 34 / 48, held through short stops |
| Bath_{1,2,3}_Temperature_{Min,Max} | REAL | degC | limits (constant) |
| Bath_{1,2,3}_Pressure | REAL | bar | ~2.4 / 2.0 / 2.2; ~0.3 on pump fault |
| Bath_{1,2,3}_Pressure_{Min,Max} | REAL | bar | limits (constant) |
| Dryer_Temperature | REAL | degC | 165 running, cools toward 82 when down |
| Cabin_{1,2}_Temperature | REAL | degC | ~23, booth climate control |
| Cabin_{1,2}_Temperature_{Min,Max} | REAL | degC | limits (constant) |
| Cabin_{1,2}_Humidity | REAL | % | ~65, rises with solvent load |
| Cabin_{1,2}_Humidity_{Min,Max} | REAL | % | limits (constant) |
| Paint_Room_Temperature | REAL | degC | ~22 |
| Paint_Room_Temperature_{Min,Max} | REAL | degC | limits (constant) |
| Paint_Room_Humidity | REAL | % | ~60 |
| Paint_Room_Humidity_{Min,Max} | REAL | % | limits (constant) |
| Machine_State | BOOL | — | true while running (~84% of the time) |
| Downtime | BOOL | — | always the complement of `Machine_State` |
| Alarm_1 | INT | — | 0, or 205 jam / 402 conveyor drive / 118 hanger / 331 oven damper |
| Alarm_2 | INT | — | 0, or 101 bath temp / 102 bath pressure / 103 pH — derived from the Min/Max bands |
| Alarm_3 | INT | — | 0, or 510 air low / 522 exhaust fan |

**`energy`** (20) — Shelly 3EM. Typical range 48–110 kW.

**Shelly 3EM signal set** (identical for both machines): `Total_Active_Power`
(kW), `Total_Current` (A), and per phase A/B/C — `Phase_X_Active_Power` (kW),
`Phase_X_Current` (A), `Phase_X_Voltage` (V ~230), `Phase_X_Power_Factor`
(0.72–0.99), `Phase_X_Frequency` (Hz ~50), `Phase_X_Apparent_Power` (kVA).

## Signal count

`teijin-machine-signals.md` states 45 painting PLC signals (65 machine / 107
site), but its table lists 44 rows — only Bath 1 has a `Ph` signal, baths 2 and
3 do not. The tables are treated as authoritative, so this publishes **44 / 64
/ 106**. If a 45th painting signal exists it is missing from that table.
