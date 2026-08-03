"""
AI Engine.

This module implements the 5-stage sequential AI pipeline powered by Google Gemini.
Stages:
1. Job Intelligence Extraction
2. Weighted Job Matching
3. Cover Letter Generation
4. Screening Q&A
5. Bid & Timeline Strategy

Outputs are structured JSON validated with Pydantic.
"""

import os
import json
import asyncio
from loguru import logger
from google import genai
from google.genai import types
from pydantic import ValidationError
from backend.models import Job, ProposalDraft
from backend.schemas import JobIntelligence, MatchResult, ProposalDraftBase, ScreeningAnswer
from sqlalchemy.ext.asyncio import AsyncSession

# Configure Gemini
api_key = os.environ.get("GEMINI_API_KEY")
client = None
if api_key:
    client = genai.Client(api_key=api_key)

# We use the recommended standard JSON model
_MODEL_NAME = "gemini-3.5-flash-lite"

async def _call_gemini_json(prompt: str, schema_class, retries=1):
    """Helper to call Gemini and validate JSON against a Pydantic schema."""
    if not client:
        raise ValueError("GEMINI_API_KEY is not configured.")

    for attempt in range(retries + 1):
        try:
            # We use to_thread to prevent blocking the async event loop with sync API call
            def _generate():
                return client.models.generate_content(
                    model=_MODEL_NAME,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json"
                    )
                )
            response = await asyncio.to_thread(_generate)
            data = json.loads(response.text)
            return schema_class.model_validate(data)
        except (json.JSONDecodeError, ValidationError) as e:
            if attempt == retries:
                logger.error(f"Failed to parse Gemini output into {schema_class.__name__}: {e}\nOutput: {response.text}")
                raise
            logger.warning(f"Retry {attempt+1}/{retries} due to parse error: {e}")
            prompt += "\n\nCRITICAL: Return ONLY valid JSON matching the schema, nothing else."
        except Exception as e:
            if any(err_kw in str(e).lower() for err_kw in ["429", "resourceexhausted", "quota", "rate limit"]):
                import re
                match = re.search(r"retry in (\d+(?:\.\d+)?)s", str(e), re.IGNORECASE)
                if not match:
                    match = re.search(r"seconds:\s*(\d+)", str(e), re.IGNORECASE)
                wait_sec = float(match.group(1)) + 1.5 if match else 15.0
                logger.warning(f"Gemini API rate limit hit (429). Waiting {wait_sec:.1f}s for quota reset before retrying...")
                await asyncio.sleep(wait_sec)
                continue
            logger.error(f"Gemini API error: {e}")
            raise

async def extract_job_intelligence(job_text: str) -> JobIntelligence:
    prompt = f"""
    Analyze the following Upwork job description and extract structured intelligence.

    JOB DESCRIPTION:
    {job_text}

    IMPORTANT BUDGET ESTIMATION RULE:
    If explicit budget or hourly rates are mentioned in the job description, extract them accurately into budget_min and budget_max.
    If the budget is NOT explicitly stated in the job post, ESTIMATE realistic market budget numbers based on the project scope, required skills, and experience level (e.g., budget_min: 50.0, budget_max: 150.0 for small tasks; budget_min: 200.0, budget_max: 500.0 for medium projects; or hourly $15.0-$40.0/hr). NEVER leave budget_min or budget_max as null.

    Return a JSON object exactly matching this schema:
    {{
        "job_title_normalized": "Clean, standard job title",
        "required_skills": ["skill1", "skill2"],
        "preferred_skills": ["skill3"],
        "experience_level": "Entry" | "Intermediate" | "Expert",
        "job_type": "Fixed" | "Hourly",
        "budget_min": float,
        "budget_max": float,
        "estimated_duration": "Short" | "Medium" | "Long",
        "screening_questions": ["question1"],
        "red_flags": ["any risky signals like vague scope"],
        "client_country": "Country Name" or null,
        "domain": "e.g., E-commerce, FinTech, SaaS"
    }}
    """
    return await _call_gemini_json(prompt, JobIntelligence)

async def evaluate_match(job_intel: JobIntelligence, profile_data: dict) -> MatchResult:
    person = profile_data.get('person', {})
    skills = profile_data.get('skills', [])
    experience = profile_data.get('experience', [])
    projects = profile_data.get('projects', [])
    education = profile_data.get('education', [])
    achievements = profile_data.get('achievements', [])
    summary = person.get('summary', '')

    prompt = f"""
    Evaluate the match between this candidate profile and the job intelligence.

    CANDIDATE SUMMARY: {summary}

    CANDIDATE SKILLS: {', '.join(skills)}

    CANDIDATE EXPERIENCE:
    {json.dumps(experience, indent=2)}

    CANDIDATE PROJECTS:
    {json.dumps(projects, indent=2)}

    CANDIDATE EDUCATION:
    {json.dumps(education, indent=2)}

    CANDIDATE ACHIEVEMENTS:
    {json.dumps(achievements, indent=2)}

    SCORING WEIGHTS:
    - Skill coverage: 40%
    - Budget fit: 20%
    - Client rating/history: 15%
    - Job clarity & scope: 15%
    - Domain match: 10%

    JOB INTELLIGENCE:
    {job_intel.model_dump_json(indent=2)}

    Return a JSON object exactly matching this schema:
    {{
        "match_score": int (0-100),
        "skill_coverage": float (percentage),
        "gap_skills": ["missing_skill"],
        "strength_points": ["why they are a fit"],
        "weakness_points": ["honest gaps"],
        "competition_level": "Low" | "Medium" | "High",
        "client_vibe": "Professional" | "Unclear" | "Risky" | "Excellent",
        "urgency_score": int (0-10),
        "recommended_bid": float,
        "recommended_action": "Apply Now" | "Apply Later" | "Skip"
    }}
    """
    return await _call_gemini_json(prompt, MatchResult)

PROPOSAL_TEMPLATE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "proposal_template.md")

def get_proposal_template() -> str:
    """Load user's proposal template markdown file."""
    try:
        if os.path.exists(PROPOSAL_TEMPLATE_PATH):
            with open(PROPOSAL_TEMPLATE_PATH, "r", encoding="utf-8") as f:
                return f.read().strip()
    except Exception as e:
        logger.warning(f"Could not read proposal_template.md: {e}")
    return """Dear [Client Name] or Sir/Madam,

[1 SENTENCE HOOK: Direct solution to their specific problem from the job post].

Recently, I built [Matching Project Name], where I [1-2 sentences explaining specific tech used, key feature built, and measurable result].

Here is how I’d approach your project:
• [Step 1: Specific architecture or tech approach]
• [Step 2: API / Integration strategy]
• [Step 3: Quality assurance & deployment execution]

[LINK TO LIVE DEMO / PLAY STORE / GITHUB]

[1 SIMPLE CLOSING QUESTION to start the chat]?

Best,
Yiheyis Tamir"""

async def generate_proposal(job_intel: JobIntelligence, match_result: MatchResult, profile_data: dict, job_description: str = "") -> ProposalDraftBase:
    person = profile_data.get('person', {})
    skills = profile_data.get('skills', [])
    experience = profile_data.get('experience', [])
    projects = profile_data.get('projects', [])
    education = profile_data.get('education', [])
    achievements = profile_data.get('achievements', [])
    summary = person.get('summary', '')
    name = "Yiheyis Tamir"
    target_rate = profile_data.get('target_rate', 10)
    min_fixed_budget = profile_data.get('min_fixed_budget', 10)
    preferred_tone = profile_data.get('preferred_tone', 'professional')

    template = get_proposal_template()

    prompt = f"""
    SYSTEM INSTRUCTIONS: DYNAMIC UPWORK PROPOSAL GENERATOR

    Act as an expert freelance proposal strategist. Write a highly converting, CONCISE, DYNAMIC, and HIGHLY TAILORED Upwork proposal for candidate: {name}.

    CRITICAL REQUIREMENT: DO NOT GENERATE REPETITIVE OR GENERIC PROPOSALS.
    Every proposal MUST be 100% uniquely customized to the exact technical details, pain points, features, and requirements described in THIS RAW JOB POSTING.

    RAW JOB POSTING / DESCRIPTION:
    --------------------------------------------------
    {job_description or job_intel.job_title_normalized}
    --------------------------------------------------

    STRUCTURAL TEMPLATE TO FOLLOW:
    --------------------------------------------------
    {template}
    --------------------------------------------------

    STRICT ADHERENCE TO THESE RULES IS MANDATORY:

    1. THE HOOK (FIRST 1-2 LINES)
    - Read the RAW JOB POSTING carefully. Line 1 MUST state directly how you will solve THIS client's specific task using exact key terms from the RAW JOB POSTING (e.g. "your delivery app", "your Go microservices backend", "your medical ML recommendation engine").
    - NEVER use generic filler (e.g. "I am writing to express interest", "I am an experienced developer", "Building high-performance apps is critical").

    2. DYNAMIC PROOF OF WORK (MOST RELEVANT PORTFOLIO PROJECT)
    - Select the SINGLE MOST RELEVANT project from the CANDIDATE PROJECTS list below that best matches THIS job's specific domain and tech stack:
        * For Flutter / Mobile / FinTech jobs -> Use "Bayment - FinTech Virtual Card & P2P Platform" (https://play.google.com/store/apps/details?id=me.bayment.app&pli=1)
        * For Go / Microservices / Backend APIs -> Use "Cashless Taxi Payment & Navigation Assistant" or "MenuMate App" (https://github.com/RealEskalate/G6-MenuMate.git)
        * For Flutter / Firebase / Maps / 3D -> Use "Virtual Home Rental APP (Guadaye-RentHub)" (https://github.com/Broker-boyz/Guadaye-RentHub.git)
        * For Python / Flask / Machine Learning / Healthcare -> Use "Disease Prediction System" (https://github.com/Yiheyistm/Disease-Prediction-and-Medical-Recommendation-System.git)
    - Mention 1-2 specific features of THAT project directly relevant to the deliverables asked for in the RAW JOB POSTING.
    - Include its live link context cleanly.

    3. JOB-SPECIFIC THREE-STEP EXECUTION PLAN
    - Detail a 3-bullet process tailored SPECIFICALLY to the exact technical deliverables requested in the RAW JOB POSTING.
    - DO NOT use static generic placeholder text. Write concrete, unique technical steps for THIS job (e.g., if it's a Go API job, describe PostgreSQL schema, Go Gin handlers, Docker setup; if Flutter, describe state management and widget layout).
    - DO NOT use placeholders like "[Step 1]" or bracketed text. Write direct, natural sentences without square brackets.

    4. JOB-SPECIFIC CLOSING TECHNICAL QUESTION
    - End with ONE low-friction, deeply relevant technical question about THIS client's specific project specs or architecture as mentioned in the RAW JOB POSTING (e.g., if Flutter -> ask about BLoC vs Riverpod; if Go -> ask about ORM vs raw SQL/gRPC; if ML -> ask about feature inputs).
    - NEVER use passive closings like "Looking forward to hearing from you" or generic "Would you like me to share examples...".

    5. TONE & FORMATTING
    - Tone: Direct, confident, human, and engineering-focused ({preferred_tone}).
    - Greeting: "Hi [Client Name]," (or "Hi there," if client name is unknown).
    - Sign-off: "Best,\nYiheyis Tamir"
    - Word Count: Maximum 140–170 words. Keep paragraphs short and punchy.
    - NO SQUARE BRACKETS: NEVER output square brackets `[...]` anywhere in the proposal text. Replace template placeholders like `[Live App / Repo Link: ...]` with clean text like `Live App: https://...` or `GitHub: https://...`.

    RULES FOR BIDDING & TIMELINE:
    - Job Type: {job_intel.job_type}
    - Candidate Target Hourly Rate: ${target_rate}/hr
    - Candidate Minimum Fixed Budget: ${min_fixed_budget}
    - Job Budget Range: Min={job_intel.budget_min}, Max={job_intel.budget_max}
    - Calculate `suggested_bid`:
        * If Hourly: Calculate an optimal hourly bid (in USD) aligned with ${target_rate}/hr and the job's hourly budget (${job_intel.budget_min} - ${job_intel.budget_max}).
        * If Fixed: Calculate a realistic total project bid (in USD, minimum ${min_fixed_budget}) matching the project scope and candidate's target rate.
    - Calculate `timeline`: A clear, structured string with weekly milestone phases separated by semicolons (e.g., "Week 1: System architecture & API setup; Week 2: Core feature development & integration; Week 3: Testing, optimization & deployment").

    CANDIDATE SUMMARY: {summary}
    CANDIDATE SKILLS: {', '.join(skills)}
    CANDIDATE PROJECTS:
    {json.dumps(projects, indent=2)}

    CANDIDATE EXPERIENCE:
    {json.dumps(experience, indent=2)}

    JOB INTELLIGENCE:
    {job_intel.model_dump_json(indent=2)}

    MATCH ANALYSIS:
    {match_result.model_dump_json(indent=2)}

    Return a JSON object matching this schema:
    {{
        "cover_letter": "The assembled cover letter string formatted with line breaks following the exact template",
        "screening_answers": [
            {{
                "question": "The question",
                "answer": "Your detailed answer",
                "requires_personal_input": boolean,
                "confidence": "High" | "Medium" | "Low"
            }}
        ],
        "suggested_bid": float,
        "timeline": "Week 1: ...; Week 2: ...; Week 3: ...",
        "tone": "{preferred_tone}"
    }}
    """
    return await _call_gemini_json(prompt, ProposalDraftBase)

async def process_job_pipeline(job: Job, profile_data: dict, db: AsyncSession, match_threshold: int = 70):
    """
    Runs the full 5-stage pipeline for a single job and saves the results to the DB.
    """
    logger.info(f"Starting AI pipeline for Job {job.id}")
    try:
        # Stage 1: Extraction
        intel = await extract_job_intelligence(job.description)

        # Update job with extracted intel
        job.required_skills = intel.required_skills
        job.preferred_skills = intel.preferred_skills
        job.screening_questions = intel.screening_questions
        job.red_flags = intel.red_flags
        job.domain = intel.domain
        if not job.client_country and intel.client_country:
            job.client_country = intel.client_country
        if job.budget_min is None and intel.budget_min is not None:
            job.budget_min = intel.budget_min
        if job.budget_max is None and intel.budget_max is not None:
            job.budget_max = intel.budget_max
        if not job.budget_type and intel.job_type:
            job.budget_type = intel.job_type
        if intel.experience_level:
            job.experience_level = intel.experience_level
        if not job.payment_verified and ("unverified payment" not in job.description.lower() and "payment unverified" not in job.description.lower()):
            job.payment_verified = True

        # Stage 2: Matching
        await asyncio.sleep(1)
        match = await evaluate_match(intel, profile_data)

        job.match_score = match.match_score
        job.competition_level = match.competition_level
        job.reasoning = match.model_dump()

        # Stage 3, 4, 5: Proposal Generation (only if match score >= threshold)
        if match.match_score >= match_threshold:
            await asyncio.sleep(1)
            logger.info(f"Job {job.id} passed threshold ({match.match_score} >= {match_threshold}). Generating proposal...")
            proposal_draft = await generate_proposal(intel, match, profile_data, job.description)

            db_proposal = ProposalDraft(
                job_id=job.id,
                cover_letter=proposal_draft.cover_letter,
                screening_answers=[a.model_dump() for a in proposal_draft.screening_answers],
                suggested_bid=proposal_draft.suggested_bid,
                timeline=proposal_draft.timeline,
                tone=proposal_draft.tone,
                version=1
            )
            db.add(db_proposal)
            job.status = "shortlisted"  # Automatically shortlist high-matching jobs
        else:
            logger.info(f"Job {job.id} failed threshold ({match.match_score} < {match_threshold}). Skipping proposal.")
            job.status = "ignored"

        await db.commit()
        logger.info(f"Successfully processed AI pipeline for Job {job.id}")

    except Exception as e:
        logger.error(f"AI Pipeline failed for Job {job.id}: {e}")
        await db.rollback()
