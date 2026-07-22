import { create } from "zustand";
import { Building } from "../building/building";
import { EntityGroup } from "../world";

type SelectionState = {
    building?: Building,
    selectBuilding: (building?: Building) => void,

    entityGroups: Set<EntityGroup>,
    selectEntityGroup: (group: EntityGroup, value: boolean) => void,
    setEntityGroups: (groups: Set<EntityGroup>) => void,
}

export const useSelection = create<SelectionState>((set) => ({
    building: undefined,
    selectBuilding: (building) => set({ building }),
    entityGroups: new Set(),
    selectEntityGroup: (group, value) => {
        if (value) {
            set((state) => ({
                entityGroups: new Set(state.entityGroups).add(group)
            }))
        } else {
            set((state) => {
                const groups = new Set(state.entityGroups)
                groups.delete(group)
                return {
                    entityGroups: groups
                }
            })
        }
    },
    setEntityGroups: (groups) => set({
        entityGroups: groups
    })
}))