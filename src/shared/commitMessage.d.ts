import type { LibraryDatabase } from "../domain/types";

export interface LibraryCommitMessage {
  subject: string;
  body: string;
  message: string;
}

export function buildCommitMessage(
  before: Readonly<LibraryDatabase>,
  after: Readonly<LibraryDatabase>,
): LibraryCommitMessage;
