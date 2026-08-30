Hey, if you are an agent - don't touch this file! I leave random notes here which may or may not be relevant to the current product direction. - milton

# BrioCare
- AI-supported care coordination built around patients, families, and clinicians.
- Order of execution: focus on getting the therapist to adopt the product first -> solve kids retention problem -> intra sessions value adds / parents education -> build a service company to provide care at scale.
- I'm just personally really aligned with this project - having gone through childhood depression myself, helping the target users means a lot to me. I'm also surprisingly well-positioned to tackle the problem as well - UX/full-stack/gamification for kids. Even if i don't get into the EIR i'd seriously want to work with the company one way or another if it were formed after the 12 weeks.

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

## Hypothesis
- if with voice & AI a better quality service can be provided
- if the service can actually scale

## Insights
- level of participation != length of speech

## Gamification Ideas
- Pets as gamified talking sticks to manage interruprions? Both human<>AI in breakout rooms, and huamn<>human as well
- When you talk your pet gets energy and dance - but too much it gets tired (therapist can control as well)
- "Dominance note" in TDD - the pet gamification can come in to offer small nudges
- Pick your pet and decorate it across sessions - and work with the pet for homework etc.

## TODOs
- make a very concise version for both design docs, or add TL;DR;
- add a why milton section in PRD: gamification app studio founder (www.hyperblob.studio); focumon.com large overlapping target audiences (k12/teens w/ adhd etc.) scaled to 100k+ users, he knows how to do gamification right and operate retentive yet ethical products
- would be super cool to have the gesture detection in the demo: fold into the tap feature (thumb-up gesture)

## Once we have a good structure
- add some lint / test commands that we can run before each commit; and put it in README.md
- need to learn how to deploy new agent code to livekit
