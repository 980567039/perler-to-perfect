import { openDB, type DBSchema } from 'idb';
import type { PatternProjectV1 } from '../domain/types';

interface SavedProjectRecord {
  id: string;
  updatedAt: string;
  project: PatternProjectV1;
  sourceBlob?: Blob;
}

interface PerlerDatabase extends DBSchema {
  projects: {
    key: string;
    value: SavedProjectRecord;
    indexes: { 'by-updated': string };
  };
}

const databasePromise = openDB<PerlerDatabase>('perler-to-perfect', 1, {
  upgrade(database) {
    const store = database.createObjectStore('projects', { keyPath: 'id' });
    store.createIndex('by-updated', 'updatedAt');
  },
});

export async function saveProject(project: PatternProjectV1, sourceBlob?: Blob): Promise<void> {
  const database = await databasePromise;
  const previous = await database.get('projects', project.id);
  await database.put('projects', {
    id: project.id,
    updatedAt: project.updatedAt,
    project,
    sourceBlob: sourceBlob ?? previous?.sourceBlob,
  });
}

export async function loadMostRecentProject(): Promise<SavedProjectRecord | undefined> {
  const database = await databasePromise;
  const transaction = database.transaction('projects');
  const index = transaction.store.index('by-updated');
  const cursor = await index.openCursor(null, 'prev');
  return cursor?.value;
}

export async function loadProject(id: string): Promise<SavedProjectRecord | undefined> {
  const database = await databasePromise;
  return database.get('projects', id);
}
