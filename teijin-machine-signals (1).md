# Teijin Leça — Machine Signals

**Site:** Teijin Automotive — Leça da Palmeira  
**Machines:** PHP 1250 (molding) · Pintura Clássica (painting)  

---

## 1. PHP 1250 — Press

### PLC A — Siemens S7-1500 (`10.205.72.20`)

| Signal | Type |
|--------|------|
| Product_Description | STRING |
| Part_Counter | INT |
| Compression_Time | REAL |
| Total_Time | REAL |
| Remaining_Time | REAL |
| Pressure | REAL |
| Movable_Platen_Position | REAL |
| Movable_Platen_State | INT |
| Speed | REAL |
| Target_Pressure | REAL |
| Target_Time | REAL |

### PLC B — Siemens S7-1200 (`10.205.72.28`)

| Signal | Type |
|--------|------|
| Fixed_Platen_Temperature_1 | REAL |
| Fixed_Platen_Temperature_1_Setpoint | REAL |
| Fixed_Platen_Temperature_2 | REAL |
| Fixed_Platen_Temperature_2_Setpoint | REAL |
| Mold_Cavity_Temperature | REAL |
| Mold_Male_Temperature | REAL |
| Movable_Platen_Temperature_1 | REAL |
| Movable_Platen_Temperature_1_Setpoint | REAL |
| Movable_Platen_Temperature_2 | REAL |
| Movable_Platen_Temperature_2_Setpoint | REAL |
| Theoretical_Cycle_Time | REAL |

### Energy meter — Shelly 3EM

| Signal | Type |
|--------|------|
| Total_Active_Power | REAL |
| Total_Current | REAL |
| Phase_A_Active_Power | REAL |
| Phase_B_Active_Power | REAL |
| Phase_C_Active_Power | REAL |
| Phase_A_Current | REAL |
| Phase_B_Current | REAL |
| Phase_C_Current | REAL |
| Phase_A_Voltage | REAL |
| Phase_B_Voltage | REAL |
| Phase_C_Voltage | REAL |
| Phase_A_Power_Factor | REAL |
| Phase_B_Power_Factor | REAL |
| Phase_C_Power_Factor | REAL |
| Phase_A_Frequency | REAL |
| Phase_B_Frequency | REAL |
| Phase_C_Frequency | REAL |
| Phase_A_Apparent_Power | REAL |
| Phase_B_Apparent_Power | REAL |
| Phase_C_Apparent_Power | REAL |

**PHP 1250 total: 42 signals** (22 PLC + 20 energy)

---

## 2. Pintura Clássica — Classic Painting Line

### PLC — Siemens S7-1200 (`10.205.72.10`)

| Signal | Type |
|--------|------|
| Line_Speed | REAL |
| Bath_1_Ph | REAL |
| Bath_1_Pressure | REAL |
| Bath_1_Pressure_Min | REAL |
| Bath_1_Pressure_Max | REAL |
| Bath_1_Temperature | REAL |
| Bath_1_Temperature_Min | REAL |
| Bath_1_Temperature_Max | REAL |
| Bath_2_Pressure | REAL |
| Bath_2_Pressure_Min | REAL |
| Bath_2_Pressure_Max | REAL |
| Bath_2_Temperature | REAL |
| Bath_2_Temperature_Min | REAL |
| Bath_2_Temperature_Max | REAL |
| Bath_3_Pressure | REAL |
| Bath_3_Pressure_Min | REAL |
| Bath_3_Pressure_Max | REAL |
| Bath_3_Temperature | REAL |
| Bath_3_Temperature_Min | REAL |
| Bath_3_Temperature_Max | REAL |
| Dryer_Temperature | REAL |
| Cabin_1_Temperature | REAL |
| Cabin_1_Temperature_Min | REAL |
| Cabin_1_Temperature_Max | REAL |
| Cabin_1_Humidity | REAL |
| Cabin_1_Humidity_Min | REAL |
| Cabin_1_Humidity_Max | REAL |
| Cabin_2_Temperature | REAL |
| Cabin_2_Temperature_Min | REAL |
| Cabin_2_Temperature_Max | REAL |
| Cabin_2_Humidity | REAL |
| Cabin_2_Humidity_Min | REAL |
| Cabin_2_Humidity_Max | REAL |
| Paint_Room_Temperature | REAL |
| Paint_Room_Temperature_Min | REAL |
| Paint_Room_Temperature_Max | REAL |
| Paint_Room_Humidity | REAL |
| Paint_Room_Humidity_Min | REAL |
| Paint_Room_Humidity_Max | REAL |
| Machine_State | BOOL |
| Downtime | BOOL |
| Alarm_1 | INT |
| Alarm_2 | INT |
| Alarm_3 | INT |

### Energy meter — Shelly 3EM

| Signal | Type |
|--------|------|
| Total_Active_Power | REAL |
| Total_Current | REAL |
| Phase_A_Active_Power | REAL |
| Phase_B_Active_Power | REAL |
| Phase_C_Active_Power | REAL |
| Phase_A_Current | REAL |
| Phase_B_Current | REAL |
| Phase_C_Current | REAL |
| Phase_A_Voltage | REAL |
| Phase_B_Voltage | REAL |
| Phase_C_Voltage | REAL |
| Phase_A_Power_Factor | REAL |
| Phase_B_Power_Factor | REAL |
| Phase_C_Power_Factor | REAL |
| Phase_A_Frequency | REAL |
| Phase_B_Frequency | REAL |
| Phase_C_Frequency | REAL |
| Phase_A_Apparent_Power | REAL |
| Phase_B_Apparent_Power | REAL |
| Phase_C_Apparent_Power | REAL |

**Pintura Clássica total: 65 signals** (45 PLC + 20 energy)

---

## Summary

| Machine | PLC signals | Energy signals | Total |
|---------|-------------|----------------|-------|
| PHP 1250 | 22 | 20 | 42 |
| Pintura Clássica | 45 | 20 | 65 |
| **Total** | **67** | **40** | **107** |
