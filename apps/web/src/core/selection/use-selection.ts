import { create } from "zustand";
import { Building } from "../building/building";

type SelectionState = {
    building?: Building,
    selectBuilding: (building?: Building) => void,
}

export const useSelection = create<SelectionState>((set) => ({
    building: undefined,
    selectBuilding: (building) => set({ building }),
}))