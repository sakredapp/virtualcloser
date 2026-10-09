// Pass-through replacement for `next/cache` when running outside Next.
module.exports = {
  unstable_cache: (fn) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
  cacheTag: () => {},
  cacheLife: () => {},
}
