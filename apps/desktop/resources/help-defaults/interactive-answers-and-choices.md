# Interactive Answers And Choices

Some Chat and Build answers contain controls you can use directly: cost tables, checklists, text comparisons, or guidance cards. The model chooses when to include them; not every answer is interactive.

## Try An Interactive Cost Table

Use this example prompt:

```text
Plan a fictional picnic for 20 people. Use supplied prices of EUR 4 for a sandwich, EUR 2 for a drink, and EUR 1 for fruit, one of each per person. Show an interactive budget with adjustable quantities and a two-item preparation checklist using the supported desktop interactive answer format. Explain the starting total in ordinary text too. Do not browse or purchase anything.
```

1. Send the prompt and wait for the answer.
2. Adjust the quantities in the budget to recalculate the displayed costs.
3. Check off items in the checklist as you complete them.
4. Use **Reset** to restore the answer's original values.

These are local display controls. They do not run another model call, purchase anything, change files, or alter a Project Management budget. The prices are those supplied by the answer; adjusting quantities does not verify the prices.

## Choose A Guidance Card

For alternatives, ask: “Present Basic, Comfortable, and Sheltered picnic packages as clickable guidance cards using the supported desktop choices format. Each card should prepare a follow-up asking for the final plan for that package. Finish this turn and wait for my choice.”

1. Wait for the agent's completed answer.
2. Click the package you want, or enter **Your own direction**.
3. Read the follow-up text added to the prompt input. Existing draft text is kept.
4. Click **Send** in Chat or **Run** in Build to start the next turn.

Choosing a card alone does not run the agent or incur model usage. Cards on older answers and cards shown while the agent is busy are disabled. This is a guidance choice, separate from approving a permission request.

## Text Comparisons

An interactive writing comparison can show **Before**, **After**, or both texts side by side. It compares text supplied in the answer; switching views does not edit your source file. For actual Build preview captures, see [Before And After](./before-and-after.md).

## State, Exports, And Other Clients

Widget edits are kept in a bounded in-memory cache, including when a long history temporarily unmounts a bubble. They are not saved to disk and should not be relied on after restarting the app. Reset restores the original answer.

The original JSON remains accessible. Existing copy/export flows use the recorded answer, not your locally adjusted widget values. Record important changed figures explicitly if you need a lasting result.

Telegram and other clients may show the prose summary or original text rather than desktop controls. The model is asked to include ordinary text alongside interactive content.

## Troubleshooting

- If ordinary code appears, the model may have returned an unsupported, incomplete, or invalid interactive block. The original text is retained instead of hidden.
- If a choice is disabled, check that it belongs to the latest completed answer and that the agent is idle.
- If a number changed locally but not in an export, the export contains the original recorded answer.

## Related Pages

- [Project Budgets And Usage](./project-budgets-and-usage.md)
- [Task Journey](./task-journey.md)
- [Project Scrapbook](./project-scrapbook.md)
