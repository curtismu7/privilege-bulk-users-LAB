# Sources and what is NOT verified

Every product claim on the Guide page comes from this list. Anything without a source is labelled UNVERIFIED on the page.

## Sourced

| Claim | Source |
|---|---|
| Privilege only knows the users of its own PingOne environment who are members of the Privilege group. A user who lives in another environment is created in Privilege's environment first (same email, username and name; default population; no password), then added to the group. | The owner's AI-DEMO2 `scripts/syncPrivilegeUsers.js` (header comment and body), in daily use; the SE1 Privilege setup guide (users belong to the `AgentPrivilege` group) |
| The worker app needs the **Identity Data Admin** role on Privilege's environment. Without it PingOne returns **empty user lists, not a 403**. | `syncPrivilegeUsers.js` header |
| Privilege can take the user and the groups from claims in a token instead of from PingOne, and it can use any claim (for example the claims in a PingFederate token). It is part of Privilege's OBO (on-behalf-of) setup. If the people already arrive in such a token, there may be nobody to register. | The owner, 2026-11-15. How it is set up is UNVERIFIED (see below). |
| The role belongs to the PingOne worker app, not to the Privilege app (which has no role to set), and Privilege only reads people from PingOne: route A writes to PingOne, never to Privilege. | The owner, 2026-11-15; consistent with `syncPrivilegeUsers.js`, which only calls the PingOne API |
| Add a user to a group with the user-centric `POST /v1/environments/{env}/users/{userId}/memberOfGroups` body `{ "id": "<groupId>" }`. The group-centric `/groups/{id}/members` call was refused for the worker app (403 with a misleading JWT-parse error). | AI-DEMO2 `scripts/addUserToGroup.js` header |
| A user created a moment ago can answer 404 on the group add until PingOne catches up: retry. | `syncPrivilegeUsers.js` ("A user created a moment ago can 404 here") |
| PingOne usernames are case-insensitive, so a matching username can be a different person: do not add that person, report a conflict. A same-username record with no email is the same account. | `syncPrivilegeUsers.js` |
| Token: `POST https://auth.pingone.{region}/{envId}/as/token`, HTTP Basic with the worker client id and secret, `grant_type=client_credentials`. API base: `https://api.pingone.{region}/v1/environments/{envId}`. | `syncPrivilegeUsers.js`, `addUserToGroup.js` |
| List by `filter=` (`name eq "..."`, `email eq "..."`, `username eq "..."`); results under `_embedded.users` / `_embedded.groups` / `_embedded.populations`; group memberships under `_embedded.groupMemberships` on `GET /users/{id}/memberOfGroups`. | `syncPrivilegeUsers.js` |
| The create body is `{ "email", "username", "name", "population": { "id": "<default population id>" } }`, with no password. The default population is the one marked `default` in `GET /populations` (else the first). | `syncPrivilegeUsers.js` (`POST ${api(dst)}/users`, `pops.find((p) => p.default) \|\| pops[0]`) |
| PingOne pages with `_links.next.href`, and caps a page at 100. | AI-DEMO2 `services/agentBuilderService.js` ("Follow _links.next (PingOne caps a page at 100)"), `services/demoReadinessPingOneReader.js` |
| Honour `Retry-After` (seconds or an HTTP date) and cap the wait. | AI-DEMO2 `services/pingOneAuthorizeService.js` |
| The Privilege console API has `GET` and `POST /api/{tenant}/v1/users` (an `imodelUser`: `ObjectMeta` + `Spec` with `UserName`, `EmailID`, `FirstName`, `LastName`, `FullName`, `Active`, `Groups`, ...). Auth is `x-api-key`, `x-api-secret` and a required `x-procyon-session-id`. | Privilege console swagger baseline 2026-11-02; the sibling `privilege-api-explorer-LAB` (verified `GET users` 200 against a local desktop console) |
| The swagger has no endpoint that generates an onboarding link and no inbound SCIM server. (`ScimProvisioning` on an application is Privilege pushing users out to a downstream app.) | Swagger baseline 2026-11-02 |

## UNVERIFIED (said so on the page)

- That `POST /v1/users` on the console, with the fields above, is accepted as-is, which `ObjectMeta` fields it requires, and whether a user created that way can sign in. Route B is documented and mock-tested only.
- Whether the console's `GET /v1/users` pages. The swagger shows no paging parameters.
- How long a new group member takes to appear in Privilege.
- That PingOne has no bulk membership call. This lab found none and goes per user.
- The "Generate Onboarding Link" step in the PingOne console (per user) has no API we could find. It may not be needed once the user is a group member; that is not tested here.
- Rate limits: this lab discovers them from 429s and does not know the numbers.
- Region list and `Retry-After` format against our own environment: from PingOne's published behaviour, not exercised by this lab's Real mode yet.
- Taking the user and the groups from token claims (the owner places it in Privilege's OBO, on-behalf-of, setup): which claim names it uses for the user and for the groups, where each is set, and whether a person who is only in a token ever shows in Privilege's user list. The console swagger's OBO settings (2026-11-02) cover the token exchange only (client, audience, scope, subject token type), with no field for choosing a claim, and this lab has not run it.

## Real mode

The first Real run is the owner's. Nothing in Real was run while this lab was built; every test uses the in-process mock.
