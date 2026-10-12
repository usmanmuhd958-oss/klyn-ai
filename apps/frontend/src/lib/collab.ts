import * as Y from 'yjs';

let doc: Y.Doc | null = null;

export function getWorkspaceDoc(): Y.Doc {
  if (!doc) doc = new Y.Doc();
  return doc;
}

export function getSharedIntentLog(): Y.Array<string> {
  return getWorkspaceDoc().getArray<string>('intent-log');
}
