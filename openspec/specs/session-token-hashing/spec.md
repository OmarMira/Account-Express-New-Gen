# Delta Spec: Session Token Hashing and Cookie Standardization

## ADDED Requirements

- **Session Token Hashing**: Session tokens saved to the `Session` table in the database are secured by storing their SHA-256 hex hash representation instead of the plaintext UUID token string.
- **Crypto Module Usage**: Native Node.js `crypto` module is used to calculate the SHA-256 hash of raw tokens.

## MODIFIED Requirements

- **`createSession` Signature and Behavior**:
  - Signature: `createSession(userId: string): Promise<string>`
  - Behavior: Generates a raw UUID token, computes its SHA-256 hash, stores the hash in the database's `Session.token` field, and returns the raw unhashed token to the caller.
- **`destroySession` Signature and Behavior**:
  - Signature: `destroySession(token: string): Promise<void>`
  - Behavior: Accepts the raw token, hashes it using SHA-256, and deletes the session record from the database matching the computed hash.
- **`getSessionUserId` Signature and Behavior**:
  - Signature: `getSessionUserId(request: NextRequest): Promise<string | null>`
  - Behavior: Retrieves the raw token via `getSessionToken(request)`, hashes it using SHA-256, queries the database's `Session` table using the computed hash, checks expiration, and returns the associated `userId` if valid (otherwise deletes the expired session and returns `null`).
- **Cookie Name Standardization**: Standardize the session cookie name to `'session_token'` across:
  - Cookie extraction in `sessions.ts` (`getSessionToken`)
  - Cookie validation in proxy middleware (`proxy.ts`)
  - Cookie setting in login (`/api/auth/login`)
  - Cookie setting in register (`/api/auth/register`)
  - Cookie clearing in logout (`/api/auth/logout`)

## REMOVED Requirements

- **Plaintext Token Storage**: Storing the raw unhashed UUID session tokens directly in the database is removed.
- **Legacy Cookie Name**: Usage of the legacy session cookie name `'session'` is removed from all middleware and routes.

## Scenarios

### Scenario 1: Creating a New Session
Given a user logs in successfully
When `createSession` is invoked for the user's ID
Then a raw UUID session token is generated
And the SHA-256 hash of the token is saved to the database
And the unhashed raw token is returned to the login route to be set as a cookie named `session_token`

### Scenario 2: Validating a Request with a Valid Session Token
Given an authenticated API request is received
When the request contains a valid raw token in the `session_token` cookie or `Authorization` header
Then `getSessionUserId` hashes the raw token using SHA-256
And queries the database for a session record with the hashed token
And verifies the session has not expired
And returns the corresponding `userId`

### Scenario 3: Destroying a Session on Logout
Given an authenticated user requests logout
When the logout route invokes `destroySession` with the raw session token
Then `destroySession` hashes the raw token using SHA-256
And deletes the session record matching the hash from the database
And the response clears the `session_token` cookie by setting it to expire immediately

### Scenario 4: Request with Expired Session
Given a request with a raw session token that has expired in the database
When `getSessionUserId` is invoked
Then the raw token is hashed using SHA-256
And the matching session record in the database is verified as expired
And the session record is deleted from the database
And `getSessionUserId` returns `null`
