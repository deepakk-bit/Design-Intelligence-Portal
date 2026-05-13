// Library actions: refresh / save / delete. Each one calls the API and
// updates the store's library slice. Kept outside the store so the store
// stays a pure state container (matches the existing pattern where
// components call api.js helpers and feed the result into the store).

import { useCanvasStore } from "../store.js";
import {
  listLibrarySaves,
  createLibrarySave,
  deleteLibrarySave,
  ApiError,
} from "./api.js";

function setLibrary(patch) {
  useCanvasStore.getState().setLibrary(patch);
}

export async function refreshLibrary() {
  setLibrary({ status: "loading", error: null });
  try {
    const saves = await listLibrarySaves();
    setLibrary({
      saves,
      status: "idle",
      error: null,
      lastFetchedAt: Date.now(),
    });
    return saves;
  } catch (err) {
    setLibrary({
      status: "error",
      error: err instanceof ApiError ? err.message : err?.message ?? "failed",
    });
    throw err;
  }
}

export async function saveDesign(payload) {
  const save = await createLibrarySave(payload);
  if (save) {
    // Optimistic prepend so the new card lands at the top of the panel
    // before the next full refresh.
    const cur = useCanvasStore.getState().library;
    setLibrary({ saves: [save, ...cur.saves] });
  }
  return save;
}

export async function deleteDesign(id) {
  await deleteLibrarySave(id);
  const cur = useCanvasStore.getState().library;
  setLibrary({ saves: cur.saves.filter((s) => s.id !== id) });
}
