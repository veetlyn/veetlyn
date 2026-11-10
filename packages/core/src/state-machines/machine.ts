// A status column's lifecycle as data: every allowed move is one row of `transitions`, and every check, compare-and-set
// guard, available action and diagram is derived from that table. A move that is not a row does not exist.

export type MachineTransition<S extends string> = { readonly from: readonly S[]; readonly to: S };

export type MachineDefinition<S extends string, E extends string> = {
  readonly name: string;
  readonly states: readonly S[];
  readonly initial: S;
  readonly transitions: Readonly<Record<E, MachineTransition<S>>>;
};

export type Machine<S extends string, E extends string> = MachineDefinition<S, E> & {
  readonly events: readonly E[];
  // States no transition leaves.
  readonly terminal: readonly S[];
  // Declared states nothing ever moves into, other than the initial one: kept for stored rows, never entered now.
  readonly unreachable: readonly S[];
  can(from: S, event: E): boolean;
  // The state after `event`, or null when the event is not allowed from `from`.
  next(from: S, event: E): S | null;
  // The states `event` may start from: the WHERE of a compare-and-set update.
  sources(event: E): readonly S[];
  allowedEvents(from: S): E[];
  isTerminal(state: S): boolean;
};

export class InvalidTransitionError extends Error {
  override readonly name = "InvalidTransitionError";
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly event: string,
  ) {
    super(`${machine}: "${event}" is not allowed from "${from}"`);
  }
}

export function defineMachine<const S extends string, const E extends string>(
  definition: MachineDefinition<S, E>,
): Machine<S, E> {
  // SAFETY: `transitions` is a Record<E, …> built from a literal, so its own keys are exactly the events E.
  const events = Object.keys(definition.transitions) as E[];
  const rules: Readonly<Record<E, MachineTransition<S>>> = definition.transitions;
  for (const event of events) {
    const rule = rules[event];
    for (const state of [...rule.from, rule.to]) {
      if (!definition.states.includes(state)) throw new Error(`${definition.name}: "${event}" names unknown state "${state}"`);
    }
  }
  if (!definition.states.includes(definition.initial)) throw new Error(`${definition.name}: unknown initial state`);
  const terminal = definition.states.filter((state) => !events.some((event) => rules[event].from.includes(state)));
  const unreachable = definition.states.filter(
    (state) => state !== definition.initial && !events.some((event) => rules[event].to === state),
  );
  return {
    ...definition,
    events,
    terminal,
    unreachable,
    can: (from, event) => rules[event].from.includes(from),
    next: (from, event) => (rules[event].from.includes(from) ? rules[event].to : null),
    sources: (event) => rules[event].from,
    allowedEvents: (from) => events.filter((event) => rules[event].from.includes(from)),
    isTerminal: (state) => terminal.includes(state),
  };
}

// The target of `event` from `from`, or InvalidTransitionError. For code paths where a refused move is a bug.
export function transitionOrThrow<S extends string, E extends string>(machine: Machine<S, E>, from: S, event: E): S {
  const to = machine.next(from, event);
  if (to === null) throw new InvalidTransitionError(machine.name, from, event);
  return to;
}

// A Mermaid stateDiagram of the table, for docs and for agents reading the lifecycle.
export function machineDiagram<S extends string, E extends string>(machine: Machine<S, E>): string {
  const lines = ["stateDiagram-v2", `  [*] --> ${machine.initial}`];
  for (const event of machine.events) {
    const rule = machine.transitions[event];
    for (const from of rule.from) lines.push(`  ${from} --> ${rule.to}: ${event}`);
  }
  for (const state of machine.terminal) {
    if (!machine.unreachable.includes(state)) lines.push(`  ${state} --> [*]`);
  }
  for (const state of machine.unreachable) lines.push(`  note right of ${state}: never entered`);
  return lines.join("\n");
}
