# @opmodel/admin-rules

React editor and summary views for a `@opmodel/engine-rules` rulebook. Renders the twelve rule cards through [@json-render/react](https://www.npmjs.com/package/@json-render/react) from the engine's catalog, with preset switching, whole-rulebook re-validation on every edit, and live plain-English previews. Brand-free, MIT, no platform code.

## Install

```bash
npm install @opmodel/admin-rules @opmodel/engine-rules @json-render/react react
```

## Quickstart

```tsx
import { RulebookEditor } from "@opmodel/admin-rules/RulebookEditor";
import { RulebookSummaryView } from "@opmodel/admin-rules/RulebookSummaryView";
import { AGENCY_RULEBOOK_SPEC, type RulebookSpec } from "@opmodel/engine-rules";
import { useState } from "react";

function RulesPage({ publish }: { publish: (spec: RulebookSpec) => void }) {
  const [spec, setSpec] = useState(AGENCY_RULEBOOK_SPEC);
  return (
    <>
      <RulebookEditor spec={spec} currency="USD" onChange={setSpec} onPublish={() => publish(spec)} />
      <RulebookSummaryView rules={spec.rules} currency="USD" />
    </>
  );
}
```

## Semantics

- Preset buttons replace the whole rulebook (`switchPreset`); any field edit marks it `custom`.
- `updateRulebook` re-validates the entire rulebook after each edit, so an invalid split or an impossible reminder window can never leave the editor.
- Tier cards render read-only; the editor's parent manages the tier list (arrays replace wholesale in `updateRulebook`).
- Styles are class hooks (`opm-*`), so the host app's design system owns the look.
