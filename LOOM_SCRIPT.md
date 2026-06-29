# Loom script - Multi-doc Q&A, grounded citations, and click-to-verify links

**Target length:** ~2:30-3:00  
**Format:** Read aloud while demonstrating the app. Bracketed cues are what to click or point at on screen.

---

## [0:00-0:28] Intro

> Hi, I'm walking through what I built for the Orbital take-home.
>
> At a high level, I developed two connected improvements: other than the **multi-document conversations**, I created **grounded citations with click-to-verify links**, which make the answer easier to trust by showing exactly what is supported, what is inferred, and where to verify it in the PDF.
>

---

## [0:28-1:52] Multi-document UX

> **[SCREEN: Open a new chat.]**
>
> Here we have a new collapsible document rail and a context usage meter.
>
> **[SCREEN: Open/expand the rail and point at the meter.]**
>
> I'll start by uploading a couple documents
> **[SCREEN: Upload two documents.]**
>
>
> **[SCREEN: Ask a comparison question across both documents.]**
>
> and I'll ask a question that would reference both files: "Give me two similarities between these documents and judge them based on UK law."
>
> **[SCREEN: Read/point at the answer, emphasizing details from both docs.]**
>
> Here, we can see here that the answer is using context from both documents. This proves the feature works end to end.
>
> **[SCREEN: Point at the footer and document rail badges.]**
>
> The response also has an enhanced citation hint at the end, and both documents now get a **Cited** badge in the rail if they got referenced. 
> This feature also needed a guardrail, even if that wasn't explicitly stated in the feature request. If we let users keep adding legal documents until the prompt silently exceeds the model window, the LLM can behave unpredictably and lose us customer trust. So the app calculates context usage before sending and blocks the message instead of truncating legal documents.
>

---

## [1:52-3:15] Grounded citations and click-to-verify

> That brings me to the second part: grounded citations.
>
> The beta showed this is the highest-leverage trust problem. In short, it helps increase trust and thus retain the users that have financial incentives.
>
> So I did not just add more citation text. I added a verification layer.
> **[SCREEN: Point at the completed answer's chips/banner.]**
>
> The judge model audits the final answer and classifies each block as document-backed (which is the green), general knowledge (which is the grey), mixed/inferred (which is the amber part), or completely unsupported.
>
> Then the backend runs a deterministic exact quote check against the extracted document text. If the judge quote is actually present, we can treat that citation as fully verified.
>
>
> **[SCREEN: Hover over a chip.]**
>
> On each of these we can see a tooltip and when we press on them, it takes us to the correct pdf, correct page, and highlight it. And this closes the loop: not just trusting the model, inspect the evidence.

---

## [3:15-4:20] Judge catching an unsupported claim

> **[SCREEN: Ask: "Give me two truths and one lie regarding Document 1 and let me guess which is which."]**
>
> I'll try one more message to see something a bit more absurd: asking the model to lie and see if the judge will be able to catch the lie.
>
> **[SCREEN: Point at amber/red/general chips or warning, depending on output.]**
>
> The answer includes an intentionally false or unsupported claim, the judge can mark that block as unsupported and it will give us a description of what exactly is going on. That is the failure mode from the beta: authoritative text that needs a visible trust signal.
>
> So this walkthrough covered both multi-document upload with safety with model context and a trust layer that turns citations into verifiable links rather than decorative footnotes.
