# Actions And Pins

Actions are reusable prompts beside **More options** in the first Chat prompt, Chat follow-ups, and Build. Adding an action prepares text; it does not start the agent.

## Try A Starter Action

1. Click an inline shortcut, or open **All actions**.
2. Choose a starter or saved prompt.
3. Fill any requested fields and review the preview.
4. Click **Add to prompt**. The text is appended to your existing draft and focus returns to the input.
5. Review the complete draft and use the normal **Send/Run** control.

Chat starts with **Compare costs**, **Research options**, and **Summarise**. Build starts with **Find a bug**, **Run tests**, and **Review changes**.

## Create An Action From Your Own Prompt

1. Write the reusable instructions in the prompt input.
2. Open **All actions → Save current prompt**.
3. Enter a name, edit the prompt, and save it to the prompt library.
4. Pin it using the pin control if it is not already pinned. New saves pin automatically when there is room.

An action can request fields using double braces. For example:

```text
Compare {{Number of options}} options for {{Event}} with a budget of {{Budget}} {{Currency}}. Show the assumptions and itemised costs.
```

Repeated field names share one value. Ordinary JSON braces are left alone. Saving waits for confirmation; if saving fails, keep the dialog open and retry after checking the error.

## Use A Prompt From The Library Or Another Source

- Existing saved prompts appear in **All actions** search. Find one and use its pin control.
- **Manage library** opens the existing prompt manager for editing and category management.
- For text from another source, paste it into the draft, then use **Save current prompt**.
- **Save this approach** under an answer creates an editable reusable template in the same library.
- Built-in recipes remain available through the saved-prompt/recipe picker. Insert and save an adapted recipe when you want it as your own pinned action.

## Pinning Limit And Overflow

The default limit is **10 pins**. Open **All actions**, edit **Pinning limit** from **1 to 50**, then click **Save limit**. The count and limit are shown in that popup.

Pins and limits are saved separately for each selected usage project and for Chat versus Build. **No project** also has separate Chat and Build preferences.

Lowering the limit keeps existing pins. Unpin some items before adding more if the count exceeds the new limit. Unpinning does not delete the saved prompt; deleting a prompt from the library removes its shortcut.

The **down-arrow button** opens **More pinned actions**, containing only the shortcuts that do not fit on the row. **All actions** separately opens the library and settings. Resizing the panel changes which pins fit inline without adding another row.

## What Is Saved?

Pin choices and limits persist on this device. Prompt content is stored in the existing prompt library. Fields used for an action are task instructions; they do not edit project budgets. Explicitly saving a prompt during incognito still saves that template.

## Troubleshooting

- No shortcut on the row? Open the down-arrow menu; the panel may be too narrow to show any inline pins.
- Different pins after changing project or mode? Each has its own saved selection.
- Pinning unavailable? Check the count and limit in **All actions**.
- The agent has not started? **Add to prompt** only fills the draft; click **Send/Run** next.

## Related Pages

- [Prompt Controls](./prompt-controls.md)
- [Saved Prompts And Recipes](./saved-prompts-and-recipes.md)
- [Answer Actions](./answer-actions.md)
