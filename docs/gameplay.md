# Gameplay Notes

## Coin Settlement

- Coins are generated from raw close-to-close returns over fixed candle intervals.
- The default interval is 8 trading days, with a final partial interval when needed.
- Balance changes only when the bike actually collects a coin.
- Missed coins are optional and do not block reaching the finish line.
- Return calculation never uses terrain height, slope, or adjusted physics coordinates.

## Coin Placement

- Regular coins sit close to the ride line and use a small pickup radius.
- Every third coin after the opening section is a jump coin placed higher above the track.
- Jump coins are intended to be collected by carrying speed into a ramp or landing with the rider/head near the coin.
- Positive-return coins use red `+` markings; negative-return coins use green `-` markings.

## Jump And Traction

- Press `Space` to jump when either wheel is grounded. Airborne jumps are rejected.
- Jump input is buffered briefly before landing so a slightly early press still fires on the first grounded frame.
- Jump force grows with horizontal speed and caps at `0.10`.
- Rear-wheel traction ramps from 15% to 100% over 200ms after landing.
- Hit-stop pauses the traction ramp so frozen time does not consume the landing transition.

## Dual Combo And Juice

- Gain and loss coins maintain separate combo slots. Collecting one kind resets the opposite slot.
- Collecting coins of the same kind inside a 6 second window builds that combo streak.
- Combo multipliers are calculated by `getComboMultiplier()` and cap at `x2.5`.
- The multiplier amplifies both gains and losses because each coin still represents the raw stock interval return.
- The HUD displays gain and loss slots side by side and highlights a slot after its streak reaches 2.
- A coin settlement briefly freezes control updates, flashes the screen, shakes the camera, and emits particles toward the balance readout.
- Switching coin direction, timing out, or crashing breaks a visible combo and plays a separate drop sound.

## Leaderboard

- Completed runs can be submitted to `/api/leaderboard`.
- Scores are ranked by total return rate, not distance, speed, or adjusted terrain.
- The API keeps only the best score for each anonymous player on each stock.
- The global leaderboard deduplicates each player to their best score across all stocks.
- Submitted stock codes and names must match the fixed local snapshot list.
- The full leaderboard can be filtered by stock and marks the current browser player without exposing other player IDs.
