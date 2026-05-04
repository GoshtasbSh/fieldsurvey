# KeyStone Heights Research Platform
### PI Presentation — 15-Minute Speaker Guide
**DTSC Lab · University of Florida**

---

> **Audience:** Community center staff and members — no technical background assumed.
> **Format:** Walk-through demo with talking points. ~15 minutes total.
> **Goal:** Show what was built, why it matters, and what it can do for the community.

---

## OPENING — *"Here's what we built for you"*
**⏱ ~1.5 min**

> *"Over the past several months, I've been building a custom software platform specifically for this community — from scratch. There was nothing off the shelf that did what we needed, so I designed and built every piece of it. What I'm going to show you today is a live, working system that two kinds of people use at the same time: the people out walking the streets collecting information, and the people at a desk watching that information come in and analyzing it."*

**Key point to land:**
- This is not a spreadsheet. This is not a pre-made app. This is a custom-built platform that I designed specifically for Keystone Heights.
- It has two parts that work together in real time: a **phone app** for the field, and a **desktop dashboard** for analysis.

---

---

## PART 1 — THE MOBILE APP
### *"The tool your surveyors carry in their pocket"*
**⏱ ~5 min**

---

### Step 1 — Show the app opening on a phone
**What to say:**
> *"The first thing I want to show you is what a surveyor sees when they're out in the neighborhood. This runs on any smartphone — iPhone, Android, doesn't matter. They don't download anything from an app store. They just open a link in their browser, and it installs itself like an app. I built it to work that way on purpose — because I wanted to make it as easy as possible for your team to use."*

**What to show:**
- Log in with email and password
- The map fills the screen — streets of Keystone Heights visible, pins on the map

---

### Step 2 — Show the map with survey pins
**What to say:**
> *"As soon as they log in, they see a live map of Keystone Heights. Every address that has already been visited shows up as a colored pin. The colors matter — green means the visit went well, yellow means there was no answer or a follow-up is needed, red means there's a concern. At a glance, a surveyor can see what's been done and what still needs attention — without calling anyone or checking a spreadsheet."*

**What to show:**
- Zoom in on a cluster of pins
- Tap one — the popup shows the address, who visited, when, and what outcome was recorded

---

### Step 3 — Show submitting a new survey point
**What to say:**
> *"When they arrive at a new address, they tap the map at that location — or just press the button to use their GPS position — and a simple form appears. They fill in what happened at this visit: did someone answer? Was the home vacant? Did they complete the full survey? They add any notes they want. Hit save, and it immediately appears on the map for everyone else on the team. I spent a lot of time making this form as fast and simple to fill out as possible, because surveyors are doing this dozens of times a day."*

**What to show:**
- Tap the map → form opens
- Fill in a couple of fields quickly
- Hit save → new pin appears on the map

---

### Step 4 — Show the offline capability
**What to say:**
> *"Here's something I'm especially proud of: the app works even when there's no signal. Keystone Heights has some areas with poor cell coverage. So I built the app to keep working offline — it saves the survey data on the phone, and the moment the surveyor gets back to an area with signal, everything syncs automatically. The map tiles are also saved locally, so the map stays visible even with no internet. The app quietly handles all of this in the background. The surveyor doesn't have to do anything special."*

**Point to the sync indicator banner at the top of the screen.**

---

### Step 5 — Show the Team tab
**What to say:**
> *"The last thing I want to show you on the phone is the Team tab. This is something a lot of field tools don't have. Your surveyors can see each other — who's active right now, when they were last seen. And they have a live group chat, built right into the app. They can send messages, they can attach a photo of a property, they can share a document. I added this because I realized that when you have multiple people out in the field at the same time, they need to be able to communicate — and switching to a different app or making a phone call breaks their flow."*

**What to show:**
- Open the Team tab
- Show the list of active surveyors with timestamps
- Show the chat with a photo attachment

---

---

## PART 2 — THE DESKTOP DASHBOARD
### *"The command center — where the data comes to life"*
**⏱ ~6.5 min**

---

### Step 6 — Open the desktop dashboard and show the map
**What to say:**
> *"Now let me show you the other half of the platform — the desktop dashboard. This is what the research team, a coordinator, or the PI uses to see the full picture. Everything the surveyors are doing in the field shows up here, live."*

> *"The first thing you notice is the map. It shows all the survey points, with the same color-coded risk system. But on the desktop, you also see the property boundaries for every single parcel in Keystone Heights — over eleven thousand properties. I built that layer by processing a large GIS database from the state of Florida and connecting it to our survey data. So now when you look at the map, you're not just seeing dots — you're seeing the actual shape of every property, and you can see which ones have been surveyed and what their risk level is."*

**What to show:**
- Full map view with colored markers
- Toggle the parcel layer on — property outlines appear over the whole town
- Zoom into a street to show individual parcels with their risk coloring

---

### Step 7 — Show the Summary tab
**What to say:**
> *"Along the top are several tabs. The Summary tab gives you the high-level picture at a glance — how many surveys have been completed, what the response rate is, how the outcomes break down. If you're a coordinator and you need to report progress to a funder or a partner agency, this is the screen you'd screenshot and send. I designed it so that the most important numbers are immediately visible without any digging."*

**What to show:**
- The summary cards: total surveys, response rate, completion breakdown
- The outcome distribution

---

### Step 8 — Show the Charts tab
**What to say:**
> *"The Charts tab is where we go from 'how many' to 'what does it mean.' You can see which streets have the highest health risk. You can see how many homes have signs of mold, or leaking water, or outdated heating systems. You can see the age distribution of housing stock on different streets. Every chart updates automatically as new survey data comes in. I spent a lot of time on the risk scoring system underneath these charts — it weighs health factors, air quality factors, and structural factors together into a single score for each household, so you can compare across the neighborhood."*

**What to show:**
- Street-by-street risk bar chart — visibly ranked
- Health indicators chart
- IAQ factors (mold, water leakage)

---

### Step 9 — Show the Streets tab
**What to say:**
> *"The Streets tab gives you a ranked table of every street in the study area. You can sort by overall risk, by health risk, by air quality risk, or by structural risk. This is designed to answer the question that I think is most useful for your team: 'Where should we focus first?' The streets at the top of the list are the ones that need the most attention. Click on any street and it zooms the map directly to those properties."*

**What to show:**
- Sort the table by Overall Risk
- Click a street name → map zooms to it

---

### Step 10 — Show the AI Chat feature
**What to say:**
> *"Now I want to show you something that I think will make this platform really valuable long-term. There's an AI assistant built into the dashboard. You can ask it questions about the data in plain English — exactly the way you'd ask a person. No codes, no filter menus, just type a question."*

> *[Type into the chat:] "Which streets have the most homes with mold?"*

> *"It reads through all of the survey data and gives you an answer. You can ask follow-up questions. You can ask it to compare two streets. You can ask it how many homes were built before 1980. This means that anyone on your team — even someone who has never used a research dashboard before — can explore the data and get answers. I built this specifically so that the data is accessible to everyone, not just to researchers who know how to use analysis software."*

**What to show:**
- Type a natural language question
- Show the AI's response — specific numbers from the data

---

### Step 11 — Show the Team tab on desktop
**What to say:**
> *"The same team presence and chat that surveyors see on their phones is also here on the desktop. So if you're sitting at a computer coordinating the field team, you can see who's active, where they've been recently, and communicate with them — all without leaving the dashboard. The chat is shared — something sent from the field appears here instantly, and vice versa."*

---

### Step 12 — Mention the automatic updates
**What to say:**
> *"One last thing: this system updates itself. Every night at midnight, the platform automatically pulls in any new data, recalculates all the risk scores, and refreshes everything. So when you come in on Monday morning, the dashboard already reflects everything that happened over the weekend. I also built in a version history — so if you ever need to go back and see what the data looked like two weeks ago, before a new batch of surveys came in, you can do that. Nothing gets lost."*

---

---

## CLOSING — *"What this means for your community"*
**⏱ ~1.5 min**

**What to say:**
> *"What I've shown you today is a complete, purpose-built research platform. The phone app and the desktop dashboard were designed together, they talk to each other in real time, and they were built specifically for the way your team works in Keystone Heights."*

> *"I want to be clear about the scope of this: this is not a template or a plugin that I plugged together. Every screen, every feature, every piece of the risk scoring model was designed and built from the ground up for this project. The offline capability alone took significant engineering work. The AI assistant, the real-time sync between the field and the desktop, the parcel boundary layer for eleven thousand properties — all of it was built specifically for this community."*

> *"The goal was always the same: to make it as easy as possible for your team to collect good data in the field, and as easy as possible for decision-makers to understand what that data is saying — so that the right resources go to the right places."*

**End with:**
> *"Happy to demo anything in more detail, or to walk through a specific scenario you have in mind."*

---

---

## QUICK REFERENCE — Features at a Glance

### Mobile App (Phone)
| Feature | What It Does |
|---|---|
| Interactive live map | Shows all survey points, color-coded by status, updated in real time |
| One-tap survey submission | GPS auto-fill, outcome selection, free-text notes |
| Offline mode | Works with no signal; auto-syncs when back online |
| Team presence | See all active surveyors and their last-seen times |
| Team chat | Live group chat with photo and document attachments |
| Secure login | Each surveyor's data is private; all points visible on shared map |

### Desktop Dashboard
| Feature | What It Does |
|---|---|
| Live map | All survey points + 11,000+ property boundaries, risk-color coded |
| Summary tab | Total surveys, response rates, outcome breakdown |
| Charts tab | Street-by-street risk, health indicators, structural factors, IAQ factors |
| Streets tab | Ranked list of every street by risk type, sortable, linked to map |
| Parcels tab | Property-level detail, linked to map |
| Results tab | Full survey table, filterable by date / collector / outcome / risk |
| AI chat | Ask any question about the data in plain English |
| Team tab | Surveyor presence + shared chat (same feed as mobile) |
| Auto-refresh | Nightly data update + recalculated risk scores |
| Version history | Restore any prior state of the data |

---

*Platform built by Goshtasb Shahriari Mehr — DTSC Lab, University of Florida*
