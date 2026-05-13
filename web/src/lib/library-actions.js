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
    const serverSaves = await listLibrarySaves();
    const cur = useCanvasStore.getState().library;
    // Merge rather than overwrite. The server is authoritative for any
    // save it knows about, but optimistic saves from a just-completed
    // POST may not yet show up in this GET response (intermediary
    // caching, edge replication lag, race between fetch + state
    // update). Without the merge, a stale empty GET clobbers the
    // optimistic save and the modal incorrectly shows "No saves yet".
    const serverIds = new Set(serverSaves.map((s) => s.id));
    const localOnly = cur.saves.filter((s) => !serverIds.has(s.id));
    const merged = [...localOnly, ...serverSaves];
    if (localOnly.length > 0) {
      console.warn(
        `[library] ${localOnly.length} local-only save(s) preserved past empty/stale GET — likely cache lag`,
      );
    }
    setLibrary({
      saves: merged,
      status: "idle",
      error: null,
      lastFetchedAt: Date.now(),
    });
    return merged;
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
    // before the next full refresh. The refresh path now merges rather
    // than overwriting, so this entry survives even if the next GET
    // hasn't seen the row yet.
    const cur = useCanvasStore.getState().library;
    setLibrary({ saves: [save, ...cur.saves] });
  } else {
    // Defensive: if the server returned a 2xx with no save body, that's
    // a contract violation worth surfacing. Without this log the user
    // sees "Saved" but the save silently vanished.
    console.error(
      "[library] POST /api/library/saves returned no save payload — server response shape changed?",
    );
  }
  return save;
}

export async function deleteDesign(id) {
  await deleteLibrarySave(id);
  const cur = useCanvasStore.getState().library;
  setLibrary({ saves: cur.saves.filter((s) => s.id !== id) });
}
