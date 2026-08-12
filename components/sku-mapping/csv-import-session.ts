export type CsvImportSession = {
  draftKey: string | null;
  commitKey: string | null;
};

export function startNewCsvImport(
  createKey: () => string,
): CsvImportSession {
  return { draftKey: createKey(), commitKey: null };
}

export function retryCsvDraft(session: CsvImportSession, createKey: () => string) {
  return session.draftKey ?? createKey();
}

export function retryCsvCommit(
  session: CsvImportSession,
  createKey: () => string,
) {
  return session.commitKey ?? createKey();
}
