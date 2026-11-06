/** Cleanup outside the component: the React Compiler doesn't compile `finally`. */
export async function settled<T>(work: () => Promise<T>, cleanup: () => void): Promise<T> {
  try {
    return await work();
  } finally {
    cleanup();
  }
}

export function fail(message: string): never {
  throw new Error(message);
}
