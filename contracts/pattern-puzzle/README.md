# Pattern Puzzle Contract

## Overview

The Pattern Puzzle contract implements a commit-reveal knowledge game on the Stellarcade platform. An admin commits a SHA-256 hash of the correct answer before any submissions are accepted. Players submit their guesses and pay an entry fee. After the submission window closes, the admin reveals the plaintext answer. The contract verifies the reveal against the stored hash, scores all submissions, and allows winning players to claim their proportional share of the prize pot.

## Game Flow

1. **Admin** calls `create_puzzle` with `SHA-256(correct_pattern)` as the commitment and an `entry_fee`.
2. **Players** call `submit_solution` with their guess bytes. Entry fees accumulate into `total_pot`.
3. **Admin** calls `resolve_round` with the plaintext `correct_pattern`. The contract verifies the commitment, iterates all submissions, marks winners, and transitions the round to `Resolved`.
4. **Winners** call `claim_reward` to receive `total_pot / winner_count` tokens.

## Methods

### `init(admin, prize_pool_contract, balance_contract)`

Initializes the contract. Can only be called once — subsequent calls return `NotAuthorized`. Admin must sign.

### `create_puzzle(admin, round_id, pattern_commitment, entry_fee)`

Opens a new puzzle round. `pattern_commitment` must be `SHA-256(correct_pattern)` computed off-chain. `entry_fee` is the token amount each player must wager (0 for free rounds). Admin only.

**Errors:** `NotInitialized`, `NotAuthorized`, `RoundAlreadyExists`, `InvalidAmount`

### `submit_solution(player, round_id, solution)`

Submits a solution guess for an open round. Each player may submit exactly once per round. `solution` is the raw bytes of the player's guess, compared byte-for-byte against the revealed pattern during `resolve_round`.

**Errors:** `RoundNotFound`, `RoundNotOpen`, `AlreadySubmitted`, `InvalidAmount`

### `resolve_round(admin, round_id, correct_pattern)`

Reveals the answer, verifies `SHA-256(correct_pattern) == stored_commitment`, iterates all submissions to identify winners, and transitions the round to `Resolved`. Admin only.

**Errors:** `NotInitialized`, `NotAuthorized`, `RoundNotFound`, `RoundNotOpen`, `CommitmentMismatch`

### `claim_reward(player, round_id) -> i128`

Claims the proportional reward (`total_pot / winner_count`) for a winning submission. Returns the reward amount. May only be called once per player per round. The claimed flag is set before any external call (reentrancy safety).

**Errors:** `RoundNotFound`, `RoundNotResolved`, `AlreadyClaimed`, `NoRewardAvailable`

### View Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `get_round(round_id)` | `Option<RoundData>` | Round metadata and state |
| `get_submission(round_id, player)` | `Option<PlayerSubmission>` | A player's stored submission |
| `has_claimed(round_id, player)` | `bool` | Whether the player has claimed for this round |

## Events

Events are defined using Soroban's `#[contractevent]` macro for type-safe, spec-included event publishing.

| Struct | Topics | Data fields | When |
|--------|--------|-------------|------|
| `RoundCreated` | `round_id` | `pattern_commitment` | `create_puzzle` |
| `SolutionSubmitted` | `player`, `round_id` | `solution` | `submit_solution` |
| `RoundResolved` | `round_id` | `correct_pattern`, `winner_count` | `resolve_round` |
| `RewardClaimed` | `player`, `round_id` | `amount` | `claim_reward` |

## Storage

| Key | Type | Description |
|-----|------|-------------|
| `Admin` | `Address` | Platform admin |
| `PrizePoolContract` | `Address` | Prize pool contract address |
| `BalanceContract` | `Address` | Token/balance contract address |
| `Round(round_id)` | `RoundData` | Round state and metadata |
| `Players(round_id)` | `Vec<Address>` | All submitters for a round |
| `Submission(round_id, player)` | `PlayerSubmission` | A player's solution and wager |
| `IsWinner(round_id, player)` | `bool` | Set `true` during `resolve_round` for correct submissions |
| `Claimed(round_id, player)` | `bool` | Set `true` after a successful `claim_reward` |

All storage uses `env.storage().instance()` for contract-lifetime persistence.

## Invariants

- A round transitions `Open → Resolved` exactly once.
- A player may submit exactly one solution per round.
- A player may claim exactly once per round.
- `total_pot == entry_fee * number_of_submissions` at all times (modulo free rounds where `entry_fee = 0`).
- `reward == total_pot / winner_count` (integer division, floor). Any remainder stays in the pool.
- `Claimed` is set before any external token transfer to prevent reentrancy.
- `winner_count = 0` if no player's solution matches the revealed pattern; in this case `claim_reward` is unreachable.

## Error Codes

| Code | Value | Description |
|------|-------|-------------|
| `NotInitialized` | 1 | `init` has not been called |
| `NotAuthorized` | 2 | Caller is not the stored admin, or `init` called twice |
| `RoundNotFound` | 3 | `round_id` does not exist |
| `RoundAlreadyExists` | 4 | `round_id` is already in use |
| `RoundNotOpen` | 5 | Round is not in `Open` state |
| `RoundNotResolved` | 6 | Round is not in `Resolved` state |
| `AlreadySubmitted` | 7 | Player has already submitted for this round |
| `AlreadyClaimed` | 8 | Player has already claimed for this round |
| `NoRewardAvailable` | 9 | Player is not a winner or `winner_count == 0` |
| `InvalidAmount` | 10 | `entry_fee < 0` or empty `solution` |
| `Overflow` | 11 | Arithmetic overflow in pot/count arithmetic |
| `CommitmentMismatch` | 12 | `SHA-256(correct_pattern) ≠ stored commitment` |

## Security

- **Commit-reveal fairness**: The pattern hash is stored before any submissions are accepted. The admin cannot change the answer after seeing submissions; any tampered reveal will fail the `SHA-256` verification.
- **Admin authorization**: All privileged functions call `Address::require_auth()` and verify the caller matches the stored admin address.
- **State machine guards**: `RoundNotOpen` and `RoundNotResolved` errors prevent out-of-order operations (e.g., double-resolve, late submissions).
- **Duplicate guards**: `AlreadySubmitted` and `AlreadyClaimed` storage checks prevent replay attacks.
- **Safe arithmetic**: `checked_add` and `checked_div` are used for all financial calculations, with `Overflow` returned on failure.
- **Reentrancy ordering**: `Claimed` is set before any external call in `claim_reward`.

## Integration Assumptions

- **Balance Contract**: `submit_solution` records the entry fee in `total_pot` but delegates actual token transfer to the `balance_contract`. The integration call site is marked with a `TODO` comment in the source.
- **Prize Pool Contract**: `claim_reward` returns the reward amount but delegates actual token transfer to the `prize_pool_contract`. The integration call site is marked with a `TODO` comment in the source.
- **Commitment Pre-computation**: The platform backend must compute `SHA-256(correct_pattern)` off-chain (using any standard SHA-256 library) before calling `create_puzzle`.
- **Dependencies**: Depends on Prize Pool (#2), Balance Contract (#3), and related infrastructure (#7, #8, #9) before production rollout.
