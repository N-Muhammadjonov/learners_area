# Local notes: Next.js behaviours measured in this repository

These are not conventions anybody chose; they are things that were measured in
this codebase on this version, written down so the same afternoon is not spent
twice.

## `loading.tsx` + navigation to the same route with a different query string

Adding `src/app/(app)/loading.tsx` (or `src/app/loading.tsx`) makes client-side
navigation to the *same route* with a *different query string* unreliable:

- the click lands and the link is followed;
- the RSC request is made and answers `200`;
- the address bar frequently never changes, and the new data never renders.

Measured with three consecutive navigations on `/reading` (`?status=passage1`):

| Setup | Navigations that committed |
| --- | --- |
| `(app)/loading.tsx` present | 1/3 – 3/5, non-deterministic |
| root `loading.tsx` present | 1/3 |
| no `loading.tsx` | 3/3, URL updates within ~200 ms |

Removing the file is the fix that is in place. When a spinner or skeleton is
wanted for a slow section, wrap that section in `<Suspense>` inside the page
instead — a route-level `loading.tsx` is not safe here.

## `scroll={false}` on a `<Link>` to the same route

Same family of problem: `<Link href="?x=1" scroll={false}>` on the current route
also failed to commit (RSC `200`, address bar unchanged). The library filters
therefore use plain links.

## `router.push` / `router.replace` for a same-route query change

`useRouter()` from `next/navigation` behaved the same way from a client
component: the RSC request was sent, the response was correct, and the URL stayed
put. Links to the same target work. Where a filter only changes the query string,
use a link; use `router.push` for a genuine route change (verified working:
starting a reading attempt navigates to `/reading/attempts/<id>`).
