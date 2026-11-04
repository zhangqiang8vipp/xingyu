export const REVISION_DELTA_FORMAT: string;
export function makeReverseDelta(newer: string, older: string): string | null;
export function applyReverseDelta(newer: string, serialized: string): string;
