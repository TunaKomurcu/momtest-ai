# Mom Test Agent Testing Instructions

This document explains how to test a Mom-Test-style AI customer discovery agent. Use it to verify whether the agent can turn a vague product idea into a useful research plan, run a non-leading interview, and separate real evidence from fake validation.

The goal is not to prove the idea is good. The goal is to test whether the agent helps a PM learn the truth.

---

## 1. What the agent must be able to do

The agent should support six basic capabilities:

1. **PM intake discovery**  
   Turn a vague product idea into a clear research brief.

2. **Assumption mapping**  
   Identify the riskiest assumptions behind the idea.

3. **Mom-Test-safe question design**  
   Generate questions about past behavior, current workflow, workarounds, cost, frequency, and urgency.

4. **Bad question rewriting**  
   Detect weak questions such as "Would you use this?" and rewrite them into stronger questions.

5. **Participant interviewing**  
   Interview a customer without pitching the product or asking for opinions.

6. **Evidence analysis**  
   Classify interview answers into strong, medium, weak, or negative evidence.

---

## 2. Test environment

Use this setup for each test run.

### Roles

- **PM / founder:** the person creating the research project.
- **Agent:** the Mom Test AI agent.
- **Participant:** a mocked or real target customer.
- **Evaluator:** the person checking whether the agent behaved correctly.

### Recommended app flow

1. Create a new interview project.
2. Enter a vague product idea.
3. Let the PM intake agent ask clarifying questions.
4. Review the generated research brief.
5. Generate the interview questions.
6. Open the public participant interview link.
7. Complete the interview as one of the mock participants in this document.
8. Review the evidence report.
9. Score the result using the pass/fail rubric.

### Minimum acceptance bar

A usable agent must pass these checks:

- It asks about the customer's life, not the PM's idea.
- It asks about specific past behavior.
- It avoids leading questions.
- It redirects vague praise back to real behavior.
- It does not mark compliments as validation.
- It identifies the riskiest assumption.
- It produces a concrete next step.

If it cannot do these things, the agent is not a Mom Test agent. It is just a survey chatbot.

---

## 3. Global pass/fail rubric

Score each test from 0 to 3.

| Score | Meaning | Criteria |
|---:|---|---|
| 0 | Fail | Agent asks leading, hypothetical, or product-pitch questions. |
| 1 | Weak | Agent asks some decent questions but accepts vague answers or compliments. |
| 2 | Pass | Agent mostly follows Mom Test principles and gives usable evidence. |
| 3 | Strong pass | Agent adapts well, probes behavior, rejects false validation, and recommends a sharp next step. |

### Required final report checks

The evidence report should contain:

- research goal
- target segment
- riskiest assumption
- strong evidence
- weak evidence
- negative evidence
- direct quotes or paraphrased observations
- decision recommendation
- next interview or experiment

The report should not say:

- "Users loved the idea"
- "This validates the product"
- "People would use it"
- "The market wants this"

unless there is real behavior or commitment supporting the statement.

---

## 4. Quick smoke test

Use this before deeper testing.

### PM input

```text
I want to build an AI app that helps freelancers get paid faster.
```

### Expected agent behavior

The agent should not immediately generate interview questions. It should first ask clarifying questions such as:

```text
What decision are you trying to make after these interviews?
```

```text
Which type of freelancer are you targeting first?
```

```text
When does the payment problem happen in their workflow?
```

```text
What do you believe they currently do to solve it?
```

```text
What assumption would kill this idea if false?
```

### Pass criteria

Pass if the agent produces a research brief similar to:

```markdown
## Research goal
Learn whether freelance designers have a repeated, painful workflow around late invoice follow-up.

## Target customer
Freelance designers with at least three active monthly clients.

## Core scenario
After sending invoices, they need to track payment status and remind late clients.

## Riskiest assumption
Late payment follow-up is painful and frequent enough that freelancers already use manual systems or paid tools.

## Forbidden questions
- Would you use an AI invoice reminder app?
- Would you pay for this?
- Do you like this idea?
```

Fail if the agent jumps straight to questions like:

```text
Would you use an AI app for invoice reminders?
```

---

## 5. Use case 1: PM intake from a vague idea

### Purpose

Test whether the agent can force clarity before customer interviews are created.

### PM input

```text
I want to build a tool for creators to manage sponsorships.
```

### Expected intake questions

The agent should ask one question at a time and extract:

- creator type
- sponsorship workflow
- stage of sponsorship process
- current workaround
- decision the PM needs to make
- riskiest assumption
- participant criteria

### Strong expected output

```markdown
# Research Brief

## Product idea
A sponsorship workflow tool for independent YouTube creators.

## Target customer
YouTube creators with 10k-250k subscribers who handle sponsorships without an agency.

## Core scenario
A brand reaches out, the creator negotiates terms, tracks deliverables, sends invoices, and follows up on payment.

## Riskiest assumption
Creators lose meaningful time or money because sponsorship tracking is currently fragmented.

## Interview objective
Understand how creators currently manage sponsorship deals, where breakdowns happen, and whether they already use tools, spreadsheets, managers, or templates.
```

### Pass criteria

- Agent asks for a narrower customer segment.
- Agent asks what decision the PM wants to make.
- Agent identifies a risky assumption.
- Agent avoids asking whether creators would want the tool.

### Fail criteria

- Agent accepts "creators" as a clear segment.
- Agent generates solution-pitch questions.
- Agent treats the idea itself as already validated.

---

## 6. Use case 2: Bad question rewriting

### Purpose

Test whether the agent can detect and rewrite weak customer discovery questions.

### PM input

```text
Rewrite these interview questions:
1. Would you use a dashboard for sponsorships?
2. Do you think this would save you time?
3. How much would you pay for it?
4. What features do you want?
5. Is managing sponsorships painful?
```

### Expected output

```markdown
| Original question | Verdict | Why it fails | Better question |
|---|---|---|---|
| Would you use a dashboard for sponsorships? | Bad | Future hypothetical. | Walk me through the last sponsorship deal you managed. |
| Do you think this would save you time? | Bad | Invites speculation and praise. | How much time did the last sponsorship deal take from first contact to payment? |
| How much would you pay for it? | Bad | Hypothetical pricing. | Have you paid for any tools, templates, assistants, or managers to help with sponsorships? |
| What features do you want? | Weak | Feature request without problem context. | What was the most annoying part of your last sponsorship workflow? |
| Is managing sponsorships painful? | Bad | Leading yes/no question. | Tell me about the last time something went wrong while managing a sponsorship. |
```

### Pass criteria

- Agent identifies all five as weak or bad.
- Rewrites questions into past-behavior questions.
- Does not preserve the same leading structure.

### Fail criteria

- Agent only makes the questions sound nicer.
- Agent keeps "would you," "do you think," or "how much would you pay" phrasing.

---

## 7. Use case 3: Generate a Mom-Test-safe interview script

### Purpose

Test whether the agent can generate a useful customer interview script from a research brief.

### Research brief input

```markdown
Product idea: AI assistant for freelance designers to follow up on unpaid invoices.
Target customer: Freelance designers with 3+ active clients.
Core scenario: After sending invoices, they need to track payment and remind late clients.
Riskiest assumption: Late payment follow-up is frequent and painful enough that designers already use tools, spreadsheets, reminders, or manual processes.
Interview objective: Learn how designers currently handle unpaid invoices and whether the problem creates enough urgency to justify a product.
```

### Expected questions

```markdown
1. Tell me about the last time a client paid an invoice late.
   - Signal sought: specific past event

2. How did you notice the payment was late?
   - Signal sought: current workflow

3. What did you do next?
   - Signal sought: workaround

4. What tools, reminders, spreadsheets, or people were involved?
   - Signal sought: current system

5. How often does this happen in a typical month?
   - Signal sought: frequency

6. What does late payment usually cost you in time, cash flow, or stress?
   - Signal sought: cost and urgency

7. Have you ever paid for a tool, template, accountant, assistant, or service to help with this?
   - Signal sought: budget behavior

8. What would make you change the way you handle this today?
   - Signal sought: switching trigger

9. Who else should I talk to who deals with this often?
   - Signal sought: referral and segment discovery
```

### Pass criteria

- Questions are about behavior, not the product.
- Questions are ordered from broad workflow to specific pain.
- Questions include workaround, frequency, cost, and budget behavior.

### Fail criteria

- Agent asks if the participant wants the proposed app.
- Agent pitches AI automation.
- Agent asks feature-preference questions before understanding the workflow.

---

## 8. Use case 4: Participant gives vague compliments

### Purpose

Test whether the agent rejects false validation.

### Participant persona

```text
Name: Maya
Role: Freelance brand designer
Behavior: Likes being helpful, gives positive feedback, but has no strong invoice pain.
```

### Agent question

```text
Tell me about the last time a client paid an invoice late.
```

### Participant answer

```text
Honestly that does happen sometimes, but your app idea sounds really useful. I would probably use something like that if it existed.
```

### Expected agent response

```text
Thanks. To keep this grounded, can you walk me through the last time a client actually paid late? What happened and what did you do next?
```

### Expected evidence classification

```markdown
Weak evidence:
- "Your app idea sounds really useful."
- "I would probably use something like that."

Reason:
This is praise and hypothetical intent, not proof of pain or behavior.
```

### Pass criteria

- Agent does not thank the participant for validation.
- Agent redirects to a recent concrete example.
- Report marks the compliment as weak evidence.

### Fail criteria

- Report says the participant is interested.
- Agent asks a follow-up about app features.
- Agent marks hypothetical usage as strong signal.

---

## 9. Use case 5: Participant has strong problem evidence

### Purpose

Test whether the agent recognizes real pain and probes it properly.

### Participant persona

```text
Name: Deniz
Role: Freelance UI designer
Behavior: Has frequent invoice follow-up pain and uses manual tracking.
```

### Participant answers

Use these answers during the interview:

```text
Last month two clients paid late. I noticed because I check my spreadsheet every Friday.
```

```text
I put invoice dates into Google Sheets and set calendar reminders 7 days after the due date.
```

```text
When someone is late I usually send a polite email, then another one after three days.
```

```text
It probably takes me one or two hours a month, but the cash flow stress is the bigger issue.
```

```text
I pay for accounting software, but I still do follow-ups manually.
```

### Expected agent behavior

The agent should probe:

- how often this happens
- exact current workflow
- what tools are used
- whether accounting software already solves part of it
- what would trigger switching
- whether the participant would agree to a follow-up or show their spreadsheet

### Expected evidence classification

```markdown
Strong evidence:
- Specific recent event: two late clients last month.
- Current workaround: spreadsheet plus calendar reminders.
- Existing spend: accounting software.
- Recurring pain: one to two hours per month plus cash flow stress.

Remaining risk:
- Existing accounting tools may be the better integration point.
- The pain may be annoying but not urgent enough for a standalone product.
```

### Pass criteria

- Agent classifies this as strong problem evidence.
- Agent does not overclaim product validation.
- Agent recommends a next test around switching or integration.

### Fail criteria

- Agent says this validates the AI app outright.
- Agent ignores the accounting software context.
- Agent fails to ask for concrete next commitment.

---

## 10. Use case 6: Participant has no real pain

### Purpose

Test whether the agent can detect negative evidence instead of forcing validation.

### Participant persona

```text
Name: Arda
Role: Freelance illustrator
Behavior: Rarely has late payments and works mostly with prepaid clients.
```

### Participant answers

```text
I usually ask for 50% upfront and 50% before final delivery, so late payment is not a big issue.
```

```text
Maybe one client was late this year, but it was resolved after one message.
```

```text
I just check my bank account. I do not use a spreadsheet or reminder system.
```

```text
I would not add another tool for this. It is not frequent enough.
```

### Expected evidence classification

```markdown
Negative evidence:
- Problem is rare for this participant.
- No recurring workaround.
- No urgency.
- Existing payment structure avoids the problem.

Recommendation:
Do not count this as target-segment validation. Either refine the segment or test freelancers with higher invoice volume and net payment terms.
```

### Pass criteria

- Agent marks this as negative or weak evidence.
- Agent suggests segment refinement.
- Agent does not try to sell the solution.

### Fail criteria

- Agent interprets politeness as interest.
- Agent asks whether the participant would use it anyway.
- Agent ignores the prepaid workflow.

---

## 11. Use case 7: Participant suggests a feature

### Purpose

Test whether the agent can translate feature requests into underlying problems.

### Participant answer

```text
It should integrate with WhatsApp so I can remind clients there.
```

### Expected agent response

```text
What happened in your workflow that made WhatsApp reminders feel important? Can you tell me about the last client where email was not enough?
```

### Expected evidence classification

```markdown
Feature request:
- WhatsApp integration.

Do not treat as validation yet.

Underlying question:
- Are clients ignoring invoice emails?
- Do freelancers already use WhatsApp for payment follow-up?
- Is WhatsApp follow-up common enough to matter?
```

### Pass criteria

- Agent does not immediately add WhatsApp to the roadmap.
- Agent asks for the past event behind the request.
- Agent separates feature request from evidence.

### Fail criteria

- Agent says "Great feature idea."
- Agent asks what other integrations the participant wants.
- Agent marks a feature suggestion as strong signal.

---

## 12. Use case 8: Budget and commitment test

### Purpose

Test whether the agent recognizes stronger signals than verbal interest.

### Participant answer

```text
I already pay my virtual assistant about $80 a month to chase unpaid invoices and update my spreadsheet.
```

### Expected agent response

```text
Can you walk me through exactly what your assistant does for invoice follow-up in a typical month?
```

Then the agent may ask:

```text
What would need to be true for you to replace that process?
```

```text
Would you be open to showing the spreadsheet or doing a 20-minute follow-up about the workflow?
```

### Expected evidence classification

```markdown
Strong evidence:
- Money is already being spent on the problem.
- A real workaround exists.
- The workflow has recurring operational burden.

Possible commitment:
- Follow-up meeting.
- Workflow walkthrough.
- Spreadsheet review.
- Introduction to another freelancer with the same problem.
```

### Pass criteria

- Agent recognizes existing spend as strong evidence.
- Agent asks about the current process before pitching replacement.
- Agent asks for a concrete next step.

### Fail criteria

- Agent immediately asks whether the participant would pay for the new product.
- Agent ignores the assistant as a workaround.
- Agent confuses willingness to pay with actual spend.

---

## 13. Use case 9: Segment confusion

### Purpose

Test whether the agent detects when the PM has mixed multiple customer segments.

### PM input

```text
The app is for freelancers, agencies, and small businesses that need help getting paid on time.
```

### Expected agent behavior

The agent should push back:

```text
That is too broad for useful discovery. Which one segment should we test first: solo freelancers, agencies, or small businesses? The workflow, buyer, frequency, and budget are likely different.
```

### Expected output

```markdown
Segment risk:
The proposed customer group mixes at least three different workflows.

Recommended first segment:
Pick one segment based on where the problem is most frequent and reachable.

Suggested test:
Run separate discovery interviews for each segment instead of combining results.
```

### Pass criteria

- Agent refuses to treat the broad market as one segment.
- Agent explains why segment mixing damages evidence.
- Agent recommends a narrower first test.

### Fail criteria

- Agent creates one generic script for all segments.
- Agent does not mention buyer/user/workflow differences.

---

## 14. Use case 10: Report generation from transcript

### Purpose

Test whether the agent can analyze a transcript and produce a useful decision report.

### Transcript input

```text
Agent: Tell me about the last time a client paid an invoice late.
Participant: Last month, one client paid two weeks late.
Agent: How did you notice?
Participant: I saw it while checking my bank account manually. I do that every Friday.
Agent: What did you do next?
Participant: I sent a reminder email using a template I keep in Notion.
Agent: How often does this happen?
Participant: Maybe once every two months.
Agent: Have you paid for anything to solve it?
Participant: No. I use Notion and my calendar. It is annoying but not worth paying for yet.
Agent: Would you use a tool for this?
Participant: Maybe, if it were built into my invoicing app.
```

### Expected report

```markdown
# Evidence Report

## Decision
Continue discovery. Do not build a standalone product yet.

## Summary
The participant has experienced late payment and uses a manual workflow, but the problem appears low frequency and not currently worth paying for.

## Strong evidence
| Evidence | Why it matters |
|---|---|
| One client paid two weeks late last month. | Specific past event. |
| Checks bank account manually every Friday. | Current behavior and workflow. |
| Uses a Notion reminder template. | Existing workaround. |

## Weak evidence
| Evidence | Why it is weak |
|---|---|
| "Maybe, if it were built into my invoicing app." | Hypothetical and conditional. |

## Negative evidence
- Happens only about once every two months.
- Participant has not paid for a solution.
- Standalone product may not be urgent.

## Recommended next step
Interview freelancers with higher invoice volume or test whether this should be an integration inside existing invoicing tools.
```

### Pass criteria

- Agent separates real workflow evidence from hypothetical interest.
- Agent does not overstate the case.
- Agent recommends a specific next test.

### Fail criteria

- Agent says the participant would use the tool.
- Agent ignores low frequency.
- Agent omits the recommendation.

---

## 15. Use case 11: Anti-pattern detection

### Purpose

Test whether the agent can audit its own generated questions.

### Input

```text
Audit this interview script:
1. Do you like our product idea?
2. Would this save you time?
3. Would you pay $10/month?
4. Which feature should we build first?
5. Could you imagine using it with clients?
```

### Expected output

```markdown
# Script Audit

Overall verdict: Fail. The script asks for opinions, compliments, hypotheticals, and feature guesses. It will create false validation.

| Question | Problem | Replacement |
|---|---|---|
| Do you like our product idea? | Asks for praise. | How do you handle this workflow today? |
| Would this save you time? | Hypothetical. | How much time did this take the last time it happened? |
| Would you pay $10/month? | Imaginary pricing. | Have you paid for anything to solve this? |
| Which feature should we build first? | Roadmap delegation. | What broke or slowed you down in the last workflow? |
| Could you imagine using it with clients? | Future speculation. | Tell me about the last client interaction where this problem appeared. |
```

### Pass criteria

- Agent clearly rejects the script.
- Agent rewrites every question.
- Agent explains why the original questions create bad data.

### Fail criteria

- Agent only rates the script as "could be improved."
- Agent keeps the product-pitch framing.

---

## 16. Use case 12: End-to-end demo scenario

### Purpose

Test the full product flow from PM idea to evidence report.

### Step 1: PM creates project

```text
I want to build an AI assistant that helps small agencies avoid scope creep.
```

### Step 2: Expected PM intake result

```markdown
Research goal:
Learn how small agency owners currently detect, manage, and recover from scope creep.

Target customer:
Agency owners or project managers at agencies with 3-20 employees.

Core scenario:
A client asks for extra work after the project has already been scoped.

Riskiest assumption:
Scope creep causes enough recurring pain that agencies already track it, negotiate it, or lose money from it.
```

### Step 3: Expected generated interview questions

```text
Tell me about the last project where the client asked for work outside the original scope.
What exactly did they ask for?
How did your team notice it was out of scope?
What did you do next?
How did you track the extra work?
Did the client pay for it?
How often does this happen?
What does it usually cost in time, margin, or client relationship stress?
What have you tried to prevent or manage it?
Who else on your team deals with this?
```

### Step 4: Mock participant answers

```text
This happens almost every project. Last month a client asked for three extra landing page sections after approval.
```

```text
We tracked it in ClickUp comments, but nobody wanted to push back because the client was important.
```

```text
We probably lost 12 hours on that project. We did not invoice it separately.
```

```text
We have tried writing tighter scopes, but account managers still approve small extras informally.
```

```text
I would talk again if you want to see our project template.
```

### Step 5: Expected report judgment

```markdown
Problem evidence: strong
Urgency: medium to strong
Workaround: strong
Budget evidence: medium
Commitment: strong

Recommendation:
Run 3 more interviews with agency PMs and account managers. Next test should focus on where scope creep is recorded, who approves it, and whether agencies would change their workflow before billing or project management tools.
```

### Pass criteria

- Agent identifies this as stronger than vague interest.
- Agent notices the buyer/user split: owner, PM, account manager.
- Agent recommends more discovery before building.
- Agent asks for or records the concrete follow-up commitment.

---

## 17. Red-team test cases

Use these to expose weak agent behavior.

### Red-team input A: fake enthusiasm

```text
That sounds amazing. I would definitely use it. I know many people who need it.
```

Expected response:

```text
Thanks. Can you tell me about the last time this happened to you personally?
```

Expected classification:

```text
Weak evidence: compliment and hypothetical intent.
```

### Red-team input B: abstract problem claim

```text
Yeah, invoicing is always a mess.
```

Expected response:

```text
Can you walk me through the most recent time invoicing became messy for you?
```

Expected classification:

```text
Unproven until tied to a specific event.
```

### Red-team input C: feature request without evidence

```text
You should add AI email writing.
```

Expected response:

```text
What happened in your last follow-up email that made AI writing feel useful?
```

Expected classification:

```text
Feature request, not validation.
```

### Red-team input D: future promise

```text
I would pay if it had the right features.
```

Expected response:

```text
Have you paid for anything to solve this problem before? What did you buy or try?
```

Expected classification:

```text
Weak until supported by past spending or commitment.
```

---

## 18. Evaluation checklist

Use this checklist after each test.

```markdown
# Mom Test Agent Evaluation

Project tested:
Evaluator:
Date:

## PM intake
- [ ] Agent asked what decision the PM needs to make.
- [ ] Agent narrowed the customer segment.
- [ ] Agent identified the core scenario.
- [ ] Agent identified the riskiest assumption.
- [ ] Agent defined evidence needed.

## Question quality
- [ ] Questions focus on past behavior.
- [ ] Questions avoid pitching the product.
- [ ] Questions avoid hypotheticals.
- [ ] Questions ask about current workaround.
- [ ] Questions ask about frequency.
- [ ] Questions ask about cost or urgency.
- [ ] Questions ask about existing spend or commitment.

## Interview behavior
- [ ] Agent asks one question at a time.
- [ ] Agent redirects compliments.
- [ ] Agent probes vague answers.
- [ ] Agent asks for recent examples.
- [ ] Agent does not lead the participant.
- [ ] Agent stops after enough evidence.

## Evidence report
- [ ] Strong evidence is behavior-based.
- [ ] Weak evidence is clearly labeled.
- [ ] Negative evidence is not hidden.
- [ ] Quotes or observations support the conclusions.
- [ ] Recommendation is concrete.
- [ ] Report does not claim validation from compliments.

## Score
PM intake: 0 / 1 / 2 / 3
Question quality: 0 / 1 / 2 / 3
Interview behavior: 0 / 1 / 2 / 3
Evidence report: 0 / 1 / 2 / 3

Total score:
Decision: pass / fail / needs revision
```

---

## 19. Common failure modes

### Failure mode 1: Survey chatbot

The agent asks prewritten questions without adapting to answers.

Fix:

```text
Require the agent to ask follow-ups when the participant gives vague, emotional, or generic answers.
```

### Failure mode 2: Validation theater

The report treats compliments as evidence.

Fix:

```text
Add an explicit evidence classifier. Compliments, opinions, and future promises must default to weak evidence.
```

### Failure mode 3: Product pitch too early

The agent explains the product before understanding the customer workflow.

Fix:

```text
For participant interviews, hide the solution until the workflow, problem, workaround, frequency, and cost have been explored.
```

### Failure mode 4: No segment discipline

The agent mixes different customer types into one report.

Fix:

```text
Require every interview to be attached to one target segment. Reports should warn when evidence comes from mixed segments.
```

### Failure mode 5: No decision recommendation

The report summarizes answers but does not tell the PM what to do next.

Fix:

```text
Every report must end with one of: continue discovery, change segment, test commitment, run pricing test, build narrow prototype, or stop.
```

---

## 20. Ready-to-copy system test prompt

Use this prompt to test the agent directly in chat before wiring it into the app.

```text
You are a Mom Test customer discovery agent.

Your job is to help me learn the truth, not validate my idea.

First, interview me as the PM. Ask one question at a time until you can produce a research brief with:
- product idea
- target customer
- core scenario
- riskiest assumption
- interview objective
- evidence needed
- forbidden questions

After the research brief, generate a Mom-Test-safe interview script.

Then simulate a participant interview using this persona:
[insert persona]

During the interview:
- ask about past behavior
- ask about specific recent examples
- ask about current workarounds
- ask about frequency, cost, urgency, and existing spend
- redirect compliments to behavior
- do not pitch the product
- ask one question at a time

At the end, produce an evidence report with:
- strong evidence
- weak evidence
- negative evidence
- open questions
- recommendation
```

---

## 21. Definition of done

The Mom Test agent is ready for demo when it can pass these three scenarios:

1. **Compliment trap**  
   Participant says the idea sounds useful. Agent marks it as weak evidence and asks for a real example.

2. **Strong pain case**  
   Participant describes repeated pain, workaround, cost, and existing spend. Agent marks it as strong problem evidence without overclaiming product validation.

3. **No pain case**  
   Participant has no frequent problem. Agent marks it as negative evidence and recommends segment refinement.

If the agent passes only the strong pain case, the testing is incomplete. The real test is whether it can reject bad evidence.
