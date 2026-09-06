# Interactive work in Chat and Build

## Live agent team

The shared background-work panel now includes a horizontal team strip. It shows the coordinating agent and each child's configured avatar, assignment, recorded lifecycle, and latest activity. Clicking a child opens its existing transcript and follow-up controls. Existing stop, inspect, recovery, replacement, archive, and session controls remain below. A brief, reduced-motion-aware handoff indicator appears when tracked results become received/incorporated; historical deliveries do not animate on initial mount.

## Interactive answers

Both Chat and Build can render validated `deskmate` JSON code fences as local controls:

- Budgets: adjustable quantity multiplied by supplied unit prices.
- Checklists: user-managed completion checks.
- Writing comparisons: before, after, and side-by-side text views.

The runtime provides the format instructions to the model, which chooses when to use a widget. A useful test prompt is: “Create an interactive picnic budget for 20 people, with food at EUR 7 per person, and a two-item preparation checklist. Use the supported desktop interactive answer format.”

There is no script execution, file mutation, or model request when a user operates a widget. Edits are retained in a bounded in-memory cache across virtualized remounts and are not written to disk. Reset returns to the original answer values. Original JSON remains accessible. Invalid, incomplete, or unsupported blocks stay visible as ordinary code. Original message contents and existing exports remain unchanged; an export does not incorporate local widget edits. Plain-language summaries are requested for clients without widget support.

## Before and after

Chat and Build support text comparisons in interactive answers. Build also has a **Before / after** button next to Screenshot in Runtime Preview:

1. Start the project preview and click **Capture before**.
2. Close the comparison and make the desired changes.
3. Reopen it and click **Capture after**.
4. Use the reveal slider or **Side by side** to inspect both actual captures.

Snapshots use the existing full-page preview capture service. Clipped captures and changed dimensions are labeled. Images remain while the workspace view is mounted, including while the comparison dialog is closed. Changing workspace or leaving the view resets them. Existing code diff, screenshot editing/export, and review controls remain available. No fabricated baseline is generated when a capture fails.

## Task journey

Chat and Build show a compact journey above the history. Planning, Researching, Creating, Checking, and Ready open a popup with recorded evidence and a **Show in history** action. Unclassified activity appears under Working. Unvisited stages remain empty; this is not a percentage meter or a claim that tests passed. Activity is grouped by the latest prompt timestamp, including equal-time restored messages. Only bounded excerpts of existing messages and activity are shown.

The status distinguishes work in progress, queued work, waiting for permission, a guidance choice, completion, stopping, and errors. Build consumes its existing task polling and restore data; the journey adds no polling or model requests. Stage details close with the close button, Escape, or clicking the backdrop.

## Guidance choices

The shared answer format now accepts `type: "choices"`, with a title and 2–3 options containing `label`, `description`, and `prompt`. The model is instructed to use it when guidance is needed, explain the alternatives in prose, and finish the turn while waiting. Invalid blocks retain the normal code fallback.

On the latest completed answer, clicking a card adds its prompt to the existing draft without deleting typed text. A **Your own direction** field accepts an alternative. The normal Send/Run button starts the next turn; that message is saved through existing task history. Cards from older answers and cards displayed while the agent is busy are disabled. Choosing a card alone neither runs the agent nor incurs model usage. This is separate from the permission system.

## Interaction appearance and completion

Open **Settings → Interaction appearance**, or use the sliders button on the journey. Calm, Balanced, and Playful apply across both modes and persist locally. Calm suppresses decorative task motion and completion sound; Balanced adds a subtle success gesture and answer highlight; Playful adds a short sparkle. Completion animations and the optional soft chime have separate switches. The chime defaults to off. OS reduced-motion preferences take precedence over completion animations.

Completion effects are brief and only follow an observed active-to-successful transition with an answer. They do not replay when history is opened and do not celebrate failures, stopped turns, or guidance requests. Effects never delay delivery of the result. Status remains readable when effects are off.

## Verification

Component tests cover local calculations, checklist and text comparison interaction, invalid JSON fallback, retained widget selections, team-card navigation, snapshot controls, and capture errors. An isolated Electron smoke test exercises the team and all three answer formats in Chat and Build. Live model generation is not part of that deterministic smoke test.

Additional tests cover journey evidence and equal-time restore order, success-only completion, reduced motion, saved preferences, choice validation, busy/stale cards, and custom directions. Isolated Electron fixtures exercise the normal Chat and Build submission paths without calling a live model.

## Agent character cards

In Chat and Build, click an avatar in the task journey, current activity indicator, or Live agent team to open its character card. Chat answer avatars retain their hover previews and also open cards on click. Relayed helper answer avatars identify the child; the name/assignment area of a team tile still opens its existing transcript directly.

Cards show the configured specialty, the current or latest assignment and status, configured capability descriptions, and recent contributions from the current conversation or exact helper run. Main-agent contributions link back to their history messages. Helper reports link to the existing transcript; **Progress & guidance** opens that helper's existing follow-up and recovery controls. **Open prompt box** focuses the main composer without inserting or sending text.

Capability descriptions are loaded on demand from the existing tool registry. Recorded child tool groups take precedence over agent defaults. Configured capabilities are distinguished from observed tools and do not bypass permissions or imply external services are connected. Missing data and lookup failures are labeled. Multiple helpers using one profile remain separate; ambiguous relayed identities never guess a sibling run.

The card floats beside the clicked avatar, fits within the viewport, and closes with **X**, Escape, or a click outside. It does not resize the task history or start agent work. Only one card is mounted per page and closed cards perform no capability lookups. Unit tests cover lazy loading, run identity, history and guidance actions, live updates, lookup failures, and task switching. An isolated Electron smoke test checks both modes and retains the existing interactive-answer and subagent controls.

## Useful reactions on answers

Chat and Build answers now have four actions, also available inside helper transcripts:

- **Useful** toggles a personal mark on this device. Ordinary marks persist across reloads; incognito marks are kept only in memory. Marks do not train or automatically instruct the agent.
- **Explain more** adds a contextual explanation request to the existing draft.
- **Try another direction** adds a contextual request for an alternative approach to the existing draft.
- **Save this approach** opens an editable template containing a new-task placeholder and the selected answer as an example. Choose a name and category, edit the template, then save to the existing prompt library.

Draft actions preserve typed text and require the normal Send/Run action to execute. Helper answer actions target the helper composer, not the main agent. References include the selected answer's original request, including when revisiting older answers or restoring same-time Build messages. Long references are bounded and marked as excerpts. Reasoning-only cards do not gain answer actions.

The save dialog closes with Cancel, X, Escape, or a click outside. Saving waits for the shared library to confirm success; errors retain edits for retry and duplicate submissions are blocked while saving. Saving from incognito explicitly retains the edited template. Component tests cover marks, context, busy state, bounded excerpts, confirmed persistence, and failure handling. Isolated Electron checks verify both main composers, persisted marks and library entries, and zero automatic task dispatches.

## Focus scene

Click **Focus** at the right of the top bar in a Chat conversation or Build. **Exit Focus** restores the normal view; Escape also exits when a dialog or menu is not handling it. Switching to another task or mode resets Focus. It is a temporary view and is not saved across app restarts.

Focus hides navigation, usage-period buttons, and secondary panels without unmounting them or changing saved layout preferences. Chat keeps the full-width scene and softened background, while its conversation, composer, activity, and team content are centred within a 60rem (960px) reading column. Long prompts and answers wrap within this column; short bubbles remain compact. Build hides Project & Workspace, terminals, logs, Git, fingerprint details, and setup controls; its existing preview or editor stays beside the conversation. If the preview section was already closed, the operator fills the scene while its content uses the same centred 60rem reading column. Narrower panels use their available width. Build uses the agent's selected chat background, or the shared background preference, with a subtle overlay. No new background or sound is generated.

Draft text, attachments, task journey, activity, and the agent team keep their existing state. Task Stop controls, preview controls, permission prompts, and guidance requests remain available. Opening or closing Focus does not start, stop, or restart a task or runtime. The underlying tool panels stay mounted so terminals and editor state survive the view change. Use Exit Focus to access the hidden tools and layout controls.

Component tests cover toggling, Escape, overlay handling, task changes, and draft preservation. Isolated Electron checks exercise both modes, unchanged Build layout preferences, retained composer/panel instances, permission visibility, and no automatic dispatch. The Build follow-up regression also runs in Focus, including parent wake-up and completion races.

## Reusable action shelf

Every action shelf, including Chat's first prompt, follow-ups, and Build, keeps pinned shortcuts on one line to the right of **More options**, separated by a vertical line. A separate **down-arrow button** appears when pinned shortcuts do not fit; it opens **More pinned actions**, a popup containing only those hidden shortcuts. **All actions** separately opens the limit setting, full library, and pin controls, without an extra overflow section. Resizing moves shortcuts into or out of the arrow dropdown without wrapping the action row. On exceptionally narrow windows the control row can scroll horizontally instead of gaining height.

Chat's first prompt, Chat follow-ups, and the Build composer show pinned actions and **All actions**. Chat starts with Compare costs, Research options, and Summarise; Build starts with Find a bug, Run tests, and Review changes. The floating panel has search, Close, Escape, and click-away dismissal. It does not expand the composer. Focus stays in the panel while open so nearby Build hover help cannot interrupt it.

Choose an action, fill any fields, check the preview, and click **Add to prompt**. The action appends to the current draft and returns focus to the composer. Only the existing Send / Run task controls dispatch work. Existing text and attachments remain. Cost and budget fields are task information; the shelf neither edits project spending limits nor invokes an agent itself.

**All actions → Save current prompt** opens an editable name and prompt, saved through the existing confirmed prompt-library API. Use placeholders such as `{{Topic}}`, `{{Currency}}`, or `{{Budget}}` for fields. Repeated names share a value; ordinary JSON braces are unchanged. Previously saved prompts and “Save this approach” entries appear in search. **Manage library** opens the existing editor. Saving during incognito explicitly retains the prompt.

Pin icons customize the shelf for the selected usage project and mode; No project has separate default Chat and Build pins. The default limit is 10. **All actions** displays the current pinned count and limit; edit **Pinning limit** (1–50) and click **Save limit** to change it for this project and mode. Existing pins are preserved when lowering the limit, but additions wait until there is room. New saves automatically pin when there is space. Pins and limits persist on this device, while prompt content remains in the existing library. Deleted prompts disappear from the shelf. No project selection or budget is changed by pinning.

Verification covers template substitution, explicit insertion, project/mode isolation, confirmed saves and retries, duplicate-save prevention, and deleted prompts. Isolated Electron checks cover first prompts, follow-ups, Build, persistence, dismissal, preserved drafts, and narrow windows without dispatching live AI work.

## Compact Build composer

Build starts with a two-line prompt editor that grows to six lines, then scrolls. The expand/collapse icon provides more writing room without changing the draft. The attachment button and **Run** sit beside the input; **Stop** replaces Run during an active task. Enter inserts a new line, and Ctrl+Enter (Cmd+Enter on macOS) runs the prompt. Submission keeps the draft until the runner accepts it, including when a parent agent wakes automatically.

One toolbar holds the project selector, **More options**, and the action shelf with its separate overflow menu. More options contains the test instruction toggle, saved-prompt selection and management, Save current prompt, Project work, and Context inspector. The working-folder label and Changes & Git popup remain available there when the layout needs them. The floating options panel closes with Close, Escape, or a click outside without stretching the composer.

The compact **Context %** indicator opens the existing token details. **Tests on** indicates when the test instruction is enabled. Attachments only occupy space when present: two file chips remain visible and **+N files** opens the remaining files, with removal available for every attachment.

Component checks cover retained drafts, explicit keyboard submission, busy/Stop behaviour, moved controls, and attachment removal. Isolated Electron checks cover sizing, expansion, options dismissal, action overflow, and Build follow-ups without live model calls.

## Project scrapbook

Open **Project Management**, select a project, then choose **Scrapbook**. It presents the project's existing Workboard notes, document/image attachments, and source links as visual cards. Archived work items are excluded. Search, type filters, and personal favorites help browse the collection; up to 48 cards render initially, with **Show more** for larger collections. Local raster images have lazy thumbnails and a missing-preview fallback. Remote image links open on demand.

**Save to scrapbook** beneath an answer in Chat or Build opens an editable snapshot with a title, project selector, and optional note. It creates a normal Workboard item tagged `scrapbook`; Chat links retain the source task ID and Build links retain the Build session ID. Helper transcripts retain their child task identity. Saving from incognito explicitly keeps the item in the project. **Save this approach** continues to use the separate reusable prompt library.

Use **Add item** within the scrapbook for a note or decision, local files/images, or a web link. A new project can be created in the save dialog. Local files remain linked at their current paths, so moving or deleting an original can make it unavailable. Notes are stored snapshots; saving waits for the existing project API to confirm persistence and retains edits on error. Duplicate clicks are blocked while saving.

Click a card to read the full saved note or inspect its image. Saved interactive budgets, checklists, and before/after comparisons use their own local view state; saved guidance choices cannot submit work. **Open original** opens a file or link; **Open linked task** returns to the recorded Chat task or Build session when available. Older Workboard entries use their existing work-item source association. **Edit in Workboard** opens that exact item with the existing editing and archive controls. Single-entry scrapbook titles follow the work-item title. Favorites store only card identifiers locally and persist across reloads.

The scrapbook uses the existing project store and does not run AI, assign task budgets, or create budget windows. Project administration remains available through the other project tabs. Unit tests cover aggregation, source identity, filtering, favorites, local-image fallback, save/retry behavior, file/link capture, and input validation. Isolated Electron checks exercise Chat and Build capture, real project persistence, image previews, reloads, source navigation, and Workboard editing without model calls.
