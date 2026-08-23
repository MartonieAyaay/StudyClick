import { openDB } from 'idb'

const DB_NAME = 'studyclick-db'
const DB_VERSION = 1
const STORE_NAME = 'reviewers'

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    },
  })
}

export async function getAllReviewers() {
  const db = await getDb()
  const all = await db.getAll(STORE_NAME)
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveReviewer(reviewer) {
  const db = await getDb()
  await db.put(STORE_NAME, reviewer)
}

export async function deleteReviewer(id) {
  const db = await getDb()
  await db.delete(STORE_NAME, id)
}