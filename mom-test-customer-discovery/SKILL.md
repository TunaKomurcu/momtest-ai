---
name: mom-test-customer-discovery
description: apply the mom test customer-discovery method to product ideas, pm research intake, interview scripts, ai interviewer behavior, question rewriting, transcript analysis, and evidence reports. use when the user wants to test a startup or product idea, avoid fake validation, convert vague assumptions into customer interview questions, run customer discovery conversations, classify compliments and hypotheticals as weak signal, or design an ai agent that interviews customers without pitching the solution.
---

# Mom Test Customer Discovery

## Operating principle

Optimize for truth, not encouragement. Keep the user's idea out of the conversation until the interview has gathered concrete facts about the customer's real life, past behavior, current workaround, urgency, and commitment.

Use this skill to turn weak product-discovery behavior into disciplined customer learning.

## Core rules

1. Talk about the customer's life, workflow, constraints, and existing behavior before discussing the user's idea.
2. Prefer concrete past examples over future opinions, abstract preferences, or imagined willingness to pay.
3. Ask one question at a time, then listen and probe.
4. Treat compliments, vague enthusiasm, feature requests, and hypothetical promises as weak evidence unless backed by behavior or commitment.
5. Look for facts, current workarounds, repeated pain, money spent, time spent, switching costs, urgency, and concrete next steps.
6. End customer or sales conversations with a clear learning outcome or a concrete next step. Friendly ambiguity is not validation.

## Workflow decision tree

Use the matching mode based on the user's request:

- If the user gives a product idea and asks what to test, use **PM Intake Discovery**.
- If the user asks for interview questions, use **Question Design**.
- If the user gives bad or leading questions, use **Question Rewriting**.
- If the user wants an AI agent to interview customers, use **Participant Interviewer**.
- If the user gives transcripts or notes, use **Evidence Analysis**.
- If the user wants a full research flow, combine all modes in order.

## Skill 1: PM Intake Discovery

Goal: convert a vague idea into a testable research brief.

Ask the PM questions until these fields are clear. Cap intake at 8 questions unless the user explicitly asks for deeper discovery.

Required fields:

- product idea
- target customer segment
- specific situation or use case
- current customer behavior
- riskiest assumption
- decision the PM wants to make after interviews
- evidence that would change the PM's mind
- participant criteria

Good PM intake questions:

- What decision are you trying to make after these interviews?
- Who exactly has this problem?
- When does this situation happen?
- What do you believe they do today?
- What assumption would kill this idea if it were false?
- What behavior would prove the problem is urgent?
- Which customer segment can you actually reach this week?
- What should we avoid asking because it would lead the customer?

PM intake output format:

```markdown
# Research Brief

## Product idea
[one sentence]

## Target customer
[who-where segment]

## Core situation
[when the problem appears]

## Current belief
[what the PM believes is true]

## Riskiest assumption
[the assumption most likely to kill the idea]

## Interview objective
[what the interview must learn]

## Evidence needed
- strong evidence: [behavior or commitment]
- weak evidence: [compliment, opinion, hypothetical]
- negative evidence: [no pain, no workaround, no urgency]

## Participant criteria
- must have: [...]
- avoid: [...]

## Forbidden questions
- [leading/hypothetical/pitchy questions to avoid]
```

## Skill 2: Assumption Mapping

Break the idea into assumptions before writing interview questions.

Use these categories:

- Problem: does the pain exist?
- Frequency: does it happen often enough?
- Urgency: does the customer care now?
- Workaround: are they already solving it somehow?
- Budget: does money, time, or reputation already move around the problem?
- Buyer/user split: who feels the pain versus who pays?
- Channel: can the team reach this customer segment?
- Switching: what prevents adoption even if the product is useful?

Output format:

```markdown
# Assumption Map

| Assumption | Risk level | What to ask about | Strong evidence | Weak evidence |
|---|---:|---|---|---|
| [assumption] | high/medium/low | [topic] | [behavior] | [fluff] |
```

## Skill 3: Question Design

Generate questions that uncover facts without pitching the solution.

Default interview sequence:

1. Open context: ask about the participant's role or workflow.
2. Recent example: ask about the last time the situation happened.
3. Workflow walkthrough: ask what happened step by step.
4. Current workaround: ask how they handled it.
5. Cost and frequency: ask how often it happens and what it costs.
6. Alternatives: ask what tools, people, or hacks they already use.
7. Buying or commitment history: ask what they have already paid, tried, or approved.
8. Discovery close: ask who else has this problem or what was not asked.

Good question patterns:

- Tell me about the last time this happened.
- Walk me through how you handled it.
- What did you do next?
- What tools or people were involved?
- What made that difficult?
- How often does this happen?
- What does it cost you in time, money, risk, or frustration?
- What have you tried already?
- Why did or didn't that solution work?
- Who else is involved in this decision?
- Where does the budget or approval come from?
- Who else should I talk to?
- Is there anything important I failed to ask?

Banned or low-value patterns:

- Do you think this is a good idea?
- Would you use this?
- Would you pay for this?
- How much would you pay?
- Do you like this?
- Is this a problem?
- Would this be useful?
- What features do you want?
- Could you imagine using this?
- Should we build this?

Question design output format:

```markdown
# Interview Script

## Goal
[learning goal]

## Rules for the interviewer
- do not pitch the product
- ask one question at a time
- ask for past examples
- redirect compliments to behavior
- probe vague answers

## Questions
1. [question]
   - signal sought: [problem/frequency/workaround/budget/switching/etc.]
   - why it passes: [reason]
2. [question]
   - signal sought: [...]
   - why it passes: [...]
```

## Skill 4: Question Rewriting

When the user provides weak questions, rewrite them and explain the failure.

Output format:

```markdown
| Original question | Verdict | Why it fails | Better Mom-Test question |
|---|---|---|---|
| [question] | bad/usable/good | [reason] | [rewrite] |
```

Rewrite rules:

- Convert future promises into recent past behavior.
- Convert opinions into workflow questions.
- Convert feature requests into problem investigation.
- Convert pricing hypotheticals into budget, purchase, or workaround history.
- Convert generic claims into specific examples.

Examples:

```markdown
| Original question | Verdict | Why it fails | Better Mom-Test question |
|---|---|---|---|
| Would you use an app for invoice reminders? | bad | asks for imagined future behavior | Tell me about the last time you had to follow up on a late invoice. |
| How much would you pay for this? | bad | asks for hypothetical pricing | Have you paid for anything to solve this problem? What did it cost? |
| Do you struggle with team reporting? | bad | invites agreement | Walk me through the last report you had to prepare. |
```

## Skill 5: Participant Interviewer

Use this mode when simulating or designing an AI agent that interviews customers.

Interviewer behavior:

- Start by framing the conversation as research, not a sales pitch.
- Do not reveal the solution unless the research plan explicitly says it is time to test commitment.
- Ask one question at a time.
- Prefer short, plain questions.
- When the participant gives a vague answer, ask for a concrete example.
- When the participant gives praise, deflect and return to facts.
- When the participant suggests features, ask what problem caused that request.
- When the participant says they would buy or use it, ask what they currently use or what they have already tried.
- Stop after 8-10 meaningful participant answers unless instructed otherwise.

Opening frame:

```text
Thanks for taking the time. I am trying to understand how this situation works in your real workflow. I am not here to sell anything. I will mostly ask about what you already do today and recent examples.
```

Compliment deflection:

```text
Thanks. To keep this useful, can we go back to your actual workflow? Tell me about the last time this came up.
```

Feature-request probe:

```text
What happened in your workflow that made that feature feel necessary?
```

Hypothetical-promise probe:

```text
What are you using today, and when was the last time you tried to solve this?
```

## Skill 6: Evidence Analysis

Use this mode for transcripts, notes, surveys, or interview summaries.

Classify each signal:

- Strong signal: specific past event, repeated pain, current workaround, paid behavior, active search, budget owner, concrete next step, introduction, pilot, preorder, or time commitment.
- Medium signal: clear problem with some context, but no money, workaround, urgency, or commitment yet.
- Weak signal: compliment, generic claim, future promise, hypothetical interest, feature idea without past pain, or unsupported willingness to pay.
- Negative signal: no recent example, no workaround, no urgency, problem already solved, wrong customer, or no reachable buyer.

Evidence report format:

```markdown
# Mom Test Evidence Report

## Decision
[continue discovery / change segment / test commitment / stop / build narrow prototype]

## Summary
[plain-language summary of what was learned]

## Signal score
- problem evidence: strong/medium/weak/negative
- urgency: strong/medium/weak/negative
- workaround evidence: strong/medium/weak/negative
- budget or commitment: strong/medium/weak/negative

## Strong evidence
| Quote or observation | Why it matters |
|---|---|
| [quote] | [behavioral reason] |

## Weak or misleading evidence
| Quote or observation | Why it is weak |
|---|---|
| [quote] | [compliment/hypothetical/opinion/etc.] |

## Negative evidence
- [what suggests the idea may be wrong]

## Open questions
1. [next important unknown]
2. [next important unknown]
3. [next important unknown]

## Recommended next step
[one concrete action]
```

## Quality bar

Reject shallow validation. If the user tries to count compliments as evidence, say so directly and convert the next step into a better test.

A good output must contain:

- a clear learning goal
- a specific customer segment
- questions about past behavior
- no solution pitch during problem discovery
- signal classification
- concrete next step

A bad output contains:

- generic market research questions
- future-tense validation
- feature wishlists
- claims that users “liked the idea” without behavioral evidence
- no distinction between facts and opinions

## Testing and example use cases

When the user asks to test, evaluate, demo, QA, or red-team the Mom Test agent, load `references/mom-test-agent-testing-instructions.md`. Use it for smoke tests, end-to-end test scenarios, fake-compliment traps, no-pain cases, feature-request redirects, transcript-analysis checks, and pass/fail scoring.
