from discord:

For those mid-build:
Bonus Points Strategy: You can secure extra judging weight by publishing a public blog post, video, or podcast documenting your data modeling journey.
Architecture Diagrams: Don't forget that an architecture diagram mapping how your Vercel deployment connects to your AWS components is a mandatory submission requirement.


from email:

Hey —

A lot of people treat the demo video like an afterthought. Those people lose.

Your video is often the first thing judges review — and for this hackathon, it has to do a lot in under three minutes: introduce the problem, show the app working, and make your database choice look intentional. Here's how to pull that off.

⏱️ The structure that works

You have less than three minutes. Use them like this:

1. The problem — ~20 seconds 🎯 Who is this for? What pain does it solve? One sentence. Don't spend thirty seconds on your company name.

2. The app in action — ~90 seconds 💻 Show it working. Don't narrate slides. Click buttons. Show real data moving. Judges want to see the thing running, not a roadmap of what it will do someday.

3. Your database choice — ~30 seconds 🗄️ This part matters more than most people think. Explain why you chose Aurora / Aurora DSQL / DynamoDB — not just that you used it, but why it was the right architectural call. Did you need distributed writes? High-throughput NoSQL? Complex relational queries? Say so. Judges are AWS database experts. They will notice when a choice was deliberate — and when it wasn't.

4. The "so what" — ~20 seconds 🚀 Who uses this? Why would they pay for it or rely on it? What's the scale potential? One punchy closing reason to care.

 

📌 What your video is strongly recommended to cover

Per the submission requirements, your video should include:

✅ The problem your app solves, for whom, and why you chose it

✅ Footage of your working application (actually running — not slides, not wireframes)

✅ The AWS Database(s) you used and why you chose them

Don't leave any of these out. Judges notice.

 

🛠️ Practical tips that will save you

✏️ Write a script first. Even bullet points. Rambling costs you time you don't have.

🎙️ AI voiceover is totally fine if you'd rather not record yourself speaking. Tools like ElevenLabs or Descript can give you a clean, professional-sounding voice track — use it if it helps.

✍️ Don't use AI to write your submission description. Judges read dozens of these. AI-written descriptions are instantly recognizable — generic, hollow, forgettable. Write in your own voice about what you actually built and why.

📤 Upload to YouTube early (preferred) — Vimeo and Youku also accepted. Large files can take hours to process. Don't find this out at 4:55 PM on June 29th.

🔊 Check your audio. Judges will sit through a rough video. They will not sit through inaudible audio.

🔓 Set your video to public before submitting. Unlisted and private videos cannot be reviewed.



Discord email important info 18 Jun 2026:
Hi there, 

Judging kicks off June 30. Before you record your video or write your project description, let's talk about what actually makes a submission score well.

The judges are AWS Database experts. They know this stack. They will notice when you genuinely thought about your data model vs. when you just wired up a database to check a box.

What they're scoring you on
🔧 Technical Implementation — Is your database integration thoughtful? Real engineering decisions, not just "it connects."

🎨 Design — Does the frontend feel coherent with the backend? Full-stack thinking, not just a pretty UI.

🌍 Impact & Real-World Applicability — Could this actually ship? Does it solve a real problem for real people?

💡 Originality — What's your genuine insight about what's possible with this stack?

 

One thing worth knowing: judges are not required to test your app. Your demo video and submission description carry a lot of weight. Make them count.

⭐ Bonus points reminder: Publish a blog post, article, podcast, or video about how you built your project before the June 29 submission deadline and earn up to +0.6 points added to your Stage 2 score. Use #H0Hackathon. See the Official Rules for details.

 
Here's what moves the needle:
Make your database choice feel intentional. Aurora, Aurora DSQL, DynamoDB — these aren't interchangeable. Why did your project need this database? If you can answer that in one sentence, put it in your description. "We used DynamoDB because our access patterns needed single-digit millisecond reads at scale" says more than a paragraph of feature descriptions. This comes through in judging.
Tell us what the project does, who it's for, and why it matters. Judges aren't reading between the lines. Your description and video should answer: What problem does this solve? For whom? Why does the stack make it better? Make it obvious. Be specific. "Small restaurant owners" beats "businesses."
Let the tech speak for itself — don't force it. You don't need to narrate every AWS call. What judges want to see is that you thought about architecture — a schema that makes sense, a deployment that goes beyond hello world, a real engineering decision somewhere in your stack. Show your work naturally, the way you'd explain it to a senior engineer.
Your video is your first impression. Under 3 minutes. Show the app working. Explain the database integration. Don't read your own README out loud.
 

A few things that'll hurt you more than help you:
✅ Don't use AI to name your project. Every other project is called "FlowForge" or "DataPulse Pro." Start with what the project actually does and riff from there. Real names are memorable. AI names are not.
✅ Do use AI for your voiceover--if you want. Text-to-speech has gotten genuinely good — a clean voiceover beats a nervous one or none at all. Just keep the script tight and don't let it run long. (Test it before you record — you'll know immediately if it sounds robotic.)
✅ Don't let AI write your project description as-is. Judges can tell. Edit it into your own voice, add the specific decisions you made, cut the filler.
Be excited about what you built. Enthusiasm is not fluff — judges are human, and they respond to projects that clearly had a person behind them.



H0: Hack the Zero Stack with Vercel v0 and AWS Databases (the “Hackathon”) Official Rules

Project Requirements
What to Create: Build a full-stack application within one of the tracks below. Regardless of track, all projects must use one of three designated Amazon Web Services Databases (Aurora, Aurora DSQL, or DynamoDB) as the primary back end and deploy their front end on Vercel or v0.app (each a “Project”).

Track 1: Monetizable B2C app. Develop a business-to-consumer application tailored for industries like ecommerce, travel, retail, or hospitality, perfect for those looking to launch a side hustle or scale a full-time venture.
Track 2: Monetizable B2B app. Create a business-to-business application that solves challenges for companies in industries such as finance, technology, healthcare, insurance, marketing and advertising, or any other sector you are passionate  about.
Track 3: Million-scale global app. Create an application in the gaming, social media, or entertainment sectors, with a thoughtful application architecture designed to be able to scale to millions of users globally.
Track 4: Open innovation. Anything goes! Build any full-stack application that creatively implements the Vercel/v0 and AWS Databases stack.
Functionality: The Project must be capable of being successfully installed and running consistently on the platform for which it is intended and must function as depicted in the video and/or expressed in the text description.

Platforms: A submitted Project must run on the platform for which it is intended and which is specified in the Submission Requirements. 

New & Existing: Projects must be either newly created by the Entrant or, if the Entrant’s Project existed prior to the Hackathon Submission Period, must have used the AWS Databases and Vercel integration after the start of the Hackathon Submission Period. Entrants should explain how their Project was significantly updated during the Submission Period. The administrator and/or the Sponsor reserve the right to request evidence of work completed during the Submission Period; failure to provide may result in disqualification.

Third Party Integrations: If a Project integrates any third-party SDK, APIs and/or data, Entrant must be authorized to use them in accordance with any terms and conditions or licensing requirements of the tool.

Submission Requirements 
Submissions to the Hackathon must meet the following requirements:

Include a Project built with the required developer tools and meets the above Project Requirements.

Include a text description that should explain the features and functionality of your Project.

Include a demonstration video of your Project. The video portion of the Submission:

should be less than three (3) minutes. Judges are not required to watch beyond three minutes 

should explain the AWS Database(s) used in the submission

should include footage that shows the Project functioning on the device for which it was built

must be uploaded to and made publicly visible on YouTube (highly preferred), Vimeo, or Youku, and a link to the video must be provided on the submission form on the Hackathon Website; and

must not include third party trademarks, or copyrighted music or other material unless the Entrant has permission to use such material.

Include which database(s) you used in your Project

Include an Architecture Diagram that shows how the project application connects to back-end components

Include a link to your published Vercel Project 

UPDATED 6/10/26 to be more inclusive if you don't use the new integration: Include a screenshot to prove AWS Database usage (e.g. Vercel Storage Configuration, AWS Console showing your Aurora/DynamoDB resource, or similar)

Include your Vercel Team ID

Multiple Submissions 

An Entrant may submit more than one Submission, however, each Submission must be unique and substantially different from each of the Entrant’s other Submissions, as determined by the Sponsor and Devpost in their sole discretion.

Submission ownership

Be the original work of the Entrant, be solely owned by the Entrant, and not violate the IP rights of any other person or entity.

Testing 

Access must be provided to an Entrant’s working Project for judging and testing by providing a link to a website, functioning demo, or a test build. If Entrant’s website is private, Entrant must include login credentials in its testing instructions. The Entrant must make the Project available free of charge and without any restriction, for testing, evaluation and use by the Sponsor, Administrator and Judges until the Judging Period ends. Judges are not required to test the Project and may choose to judge based solely on the text description, images, and video provided in the Submission.

If the Project includes software that runs on proprietary or third party hardware that is not widely available to the public, including software running on devices or wearable technology other than smartphones, tablets, or desktop computers, the Sponsor and/or Administrator reserve the right, at their sole discretion, to require the Entrant to provide physical access to the Project hardware upon request.  

6. Judges & Criteria
Sponsor and Administrator reserve the sole right to determine the eligibility and judging methodologies for all submissions. This process may utilize expert panels, peer review, automated AI-driven analysis, or any combination thereof to ensure efficient, fair, and objective evaluation. Eligible submissions will be evaluated by a panel of judges selected by the Sponsor (the “Judges”). Judges may be employees of the sponsor or third parties, may or may not be listed individually on the Hackathon Website, and may change before or during the Judging Period. Judging may take place in one or more rounds with one or more panels of Judges, at the discretion of the sponsor. 

Stage One) The first stage will determine via pass/fail whether the ideas meet a baseline level of viability, in that the Project reasonably fits the theme and reasonably applies the required APIs/SDKs featured in the Hackathon. This stage may be conducted through manual, automated, and/or AI-assisted review. Automated scoring against the Stage Two Judging Criteria may evaluate Submissions to determine which advance to Stage Two.

Stage Two) All Submissions that pass Stage One will be evaluated in Stage Two based on the following equally weighted criteria (the “Judging Criteria”):

Entries will be judged on the following equally weighted criteria, and according to the sole and absolute discretion of the judges:

Technical Implementation

Does the project demonstrate genuine software craftsmanship? Is the chosen AWS Database (Aurora, Aurora DSQL, or DynamoDB) integrated thoughtfully — with a data model, schema, or query design that reflects a deliberate architectural choice? Does the Vercel deployment go beyond a basic setup? Is the application architecture clean, maintainable, and purposeful, showing real engineering decisions rather than surface-level generation?

Design

Is the user experience intuitive and well-considered? Does the front-end feel designed in relation to the back-end? Is there a cohesive, intentional balance between the two layers that reflects full-stack thinking?

Impact & Real-World Applicability

Does the project solve a meaningful problem for a real audience? Does the use of scalable database infrastructure and frontend deployment make the solution more viable — not just functional, but potentially shippable? How big could the impact be beyond the immediate use case?

Originality 

How creative and original is the concept? Does the project demonstrate a genuine insight about what's possible with this stack? If the idea isn't new, how significantly does this implementation push it forward?

 

Bonus contributions (optional): Submissions that advance to Stage Two may earn up to 0.6 additional points on top of their score by publishing a piece of content (blog, podcast, video) covering how the project was built using one of the required databases and Vercel on any public platform (e.g., builder.aws.com, medium.com, dev.to, YouTube, etc.). You can submit more than one piece of content (0.2 each). The content must be public (not unlisted). You must include language that says you created the piece of content for the purposes of entering this hackathon. 

A maximum of 0.6 points will be added. When sharing on social media, use the hashtag #H0Hackathon. Submissions without a bonus contribution receive their Stage Two score only. Final scores range from 1 to 5.6.

The scores from the Judges will determine the potential winners of the applicable prizes. The Entrant(s) that are eligible for a Prize, and whose Submissions earn the highest overall scores based on the applicable Judging Criteria, will become potential winners of that Prize.

Tie Breaking 

For each Prize listed below, if two or more Submissions are tied, the tied Submission with the highest score in the first applicable criterion listed above will be considered the higher scoring Submission. In the event any ties remain, this process will be repeated, as needed, by comparing the tied Submissions’ scores on the next applicable criterion. If two or more Submissions are tied on all applicable criteria, the panel of Judges will vote on the tied Submissions.



You no longer need to choose between shipping quickly and using data infrastructure that will hold up in real-world traffic and scale. With the integration between AWS Databases and Vercel, the application you prototype over a weekend can run on the same data foundation that startups and enterprises use for production deployment. You can focus on building and iterating on your product quickly on an operationally proven database from day one. Use Vercel’s v0 to scaffold a production-ready Next.js frontend and connect it to one of three AWS Databases: Amazon Aurora PostgreSQL Aurora DSQL, or DynamoDB. Build a full-stack application that could actually go to production in minutes.

Requirements
What to Create
Build a full-stack application within one of the tracks below. Regardless of track, you must use one of three designated AWS Databases (Aurora PostgreSQL, Aurora DSQL, or DynamoDB) and deploy your front end on Vercel or v0.app.

Track 1: Monetizable B2C app. Develop a business-to-consumer application tailored for industries like ecommerce, travel, retail, or hospitality, perfect for those looking to launch a side hustle or scale a full-time venture.
Track 2: Monetizable B2B app. Create a business-to-business application that solves challenges for companies in industries such as finance, technology, healthcare, insurance, marketing and advertising, or any other sector you are passionate about.
Track 3: Million-scale global app. Create an application in the gaming, social media, or entertainment sectors, with a thoughtful application architecture designed to be able to scale to millions of users globally.
Track 4: Open innovation. Anything goes! Build any full-stack application that creatively implements the Vercel/v0 and AWS Databases stack.

Judges
Joseph Idziorek
Joseph Idziorek
Director, Product management, AWS Databases

Tim Stoakes
Tim Stoakes
Sr. Principal Technologist

Karthik Vijayraghavan
Karthik Vijayraghavan
Sr Manager, NoSQL Solutions Architects, AWS

Aditya Samant
Aditya Samant
Principal Database Specialist Solutions Architect, AWS Databases

David Castro 
David Castro
Principal Product Manager, AWS Databases

Tony Gibbs
Tony Gibbs
Senior Manager, Specialist Solutions Architects

Rohan Bhatia
Rohan Bhatia
Principal Product Manager, AWS Databases

Abhinav Anand
Abhinav Anand
Technical Product Marketing, AWS