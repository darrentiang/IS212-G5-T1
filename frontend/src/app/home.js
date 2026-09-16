import { routes } from './areas'

// Home is the first nav entry, in the combined list's order, that this account
// may open (docs/design/frontend.md §4, ui-guidelines.md §1). Three of five
// roles cannot view event requests, so nobody is sent to a fixed /requests.
// null means the account may open no page at all.
//
// App is the only caller. Pages navigate and link to '/' and let App turn that
// into the page below, which keeps them independent of the route list; and
// keeping this function out of App.jsx, which the route list reaches through
// the pages it holds, leaves the front end with no import cycle.
export function homePathFor(account) {
  const entry = routes.find(
    (route) => route.nav && (!route.permission || Boolean(account?.features?.includes(route.permission))),
  )
  return entry ? entry.path : null
}
