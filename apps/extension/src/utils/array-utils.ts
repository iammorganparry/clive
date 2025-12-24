/**
 * Array manipulation utilities
 */

/**
 * Chunk an array into batches of specified size
 *
 * @param array - The array to chunk
 * @param size - The size of each chunk
 * @returns An array of chunks, each containing up to `size` elements
 *
 * @example
 * ```typescript
 * chunkArray([1, 2, 3, 4, 5], 2) // Returns [[1, 2], [3, 4], [5]]
 * chunkArray(['a', 'b', 'c'], 1) // Returns [['a'], ['b'], ['c']]
 * ```
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size),
  );
}
