Hey, if you are an agent - don't touch this file! I leave random notes here which may or may not be relevant to the current product direction. - milton

# BrioCare
AI-supported care coordination built around patients, families, and clinicians

## Notes
- telehealth
- 6-12 kids per group (max 12), age 6-12
- value = increase quality + throughput of therapy + decrease cost
- eventually we consider hiring therapist to offer a complete service instead of SaaS

## Personas
- therapist pain: facilitation friction / scaling
- kids pain: uneven engagement / opportunity to participate / attention received; kids have bad first experience and drops off
- (?) parents pain: very long wait (3+ months to therapy)

## Challenges
- deal with punctualness in sessions
- making sure everyone's engaged, and has even participation (currently facilitation is purely the therapist's job)
  - some people tend to participate more!
  - deal with some kids social anxiety
- synthesis and report after the session

## Features
- therapist panel
  - check real time engagement
  - admin stuff, mute/unmute
- ai prompts to kids? ("hey it's andy's turn")
- breakout room where parallel discussions can happen
  - can have ai real time prompts in there as well

## Insights
- level of participation != length of speech

## Hypothesis
- if with voice & AI a better quality service can be provided
- if the service can actually scale

## Gamification Ideas
- Pets as gamified talking sticks to manage interruprions? Both human<>AI in breakout rooms, and huamn<>human as well
- When you talk your pet gets energy and dance - but too much it gets tired (therapist can control as well)
- "Dominance note" in TDD - the pet gamification can come in to offer small nudges
- Pick your pet and decorate it across sessions - and work with the pet for homework etc.

## TODOs
- make a very concise version for both design docs, or add TL;DR;
- generate images for the PRD - just hand the human the exact prompts for each image, and image name to save
- add a why milton section in PRD: gamification app studio founder (www.hyperblob.studio); focumon.com large overlapping target audiences (k12/teens w/ adhd etc.) scaled to 100k+ users, he knows how to do gamification right and operate retentive yet ethical products
- would be super cool to have the gesture detection in the demo: fold into the tap feature (thumb-up gesture)



great! now let's draft the convex schema in a real convex setup. follow https://docs.convex.dev/ai/using-claude-code - and ask for my help when needed. Make sure we start the work under /src so we don't make the project root directory overwhelming to read. For now, only write the schema - no other implementation beside that and setting up a new convex project.
