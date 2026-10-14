# AI বাজার বিশ্লেষক: Netlify সেটআপ

এই ফোল্ডারে তিনটি জিনিস আছে:
- `index.html`: পুরো ওয়েবসাইট (AI চ্যাটবক্স সহ)
- `netlify/functions/ask.mjs`: Gemini-র সাথে কথা বলার ফাংশন (API key শুধু এখানে, সার্ভারে থাকে)
- `netlify.toml`: Netlify-কে কোন ফোল্ডার কী, তা বলে দেয়

## ১. ফ্রি Gemini API key নিন
1. https://aistudio.google.com এ Google অ্যাকাউন্ট দিয়ে ঢুকুন
2. **Get API key → Create API key** চাপুন
3. key-টা কপি করে নিজের কাছে রাখুন। কাউকে বা কোনো চ্যাটে পাঠাবেন না।

## ২. GitHub-এ ফাইল তুলুন (Netlify ফাংশন চালাতে এটা লাগে)
1. github.com এ নতুন **private** repository বানান (যেমন `bd-aluminium-market`)
2. **Add file → Upload files** দিয়ে এই ফোল্ডারের সব ফাইল ও ফোল্ডার তুলুন (`netlify` ফোল্ডারসহ)
3. **Commit changes** চাপুন

> শুধু ড্র্যাগ-অ্যান্ড-ড্রপ ডিপ্লয়ে সাধারণত ফাংশন চালু হয় না, তাই GitHub (বা Netlify CLI) ব্যবহার করুন।

## ৩. Netlify-তে যুক্ত করুন
1. app.netlify.com → **Add new project → Import an existing project → GitHub**
2. repository বেছে নিন। Build command খালি রাখুন, Publish directory: `.`
3. **Deploy** চাপুন

## ৪. API key বসান
1. Netlify-তে প্রজেক্ট → **Project configuration → Environment variables → Add a variable**
2. Key: `GEMINI_API_KEY`  ·  Value: আপনার কপি করা key
3. **Deploys → Trigger deploy → Deploy project** চাপুন (নতুন key কাজে লাগাতে)

## ৫. পরীক্ষা
- সাইট খুলে `https://আপনার-সাইট.netlify.app/api/ask` দেখুন। `"configured":true` দেখালে ঠিক আছে।
- চ্যাটবক্স খুললে উপরে সবুজ বিন্দুসহ **AI** লেখা দেখাবে।

## দরকারি তথ্য
- **মডেল বদলাতে:** Environment variable `GEMINI_MODEL` যোগ করুন (ডিফল্ট `gemini-3.8-flash`)। প্রধান মডেল সীমা ছুঁলে ফাংশন নিজে থেকে `gemini-3.5-flash-lite` ব্যবহার করে।
- **ফ্রি সীমা:** Google প্রতিদিন নির্দিষ্ট সংখ্যক প্রশ্ন ফ্রি দেয়। কত বাকি, তা AI Studio-র Rate limit পাতায় দেখা যায়। সীমা শেষ হলে চ্যাটবক্স অফলাইন বিশ্লেষক দিয়ে উত্তর দেয়।
- **AI / অফলাইন বোতাম:** চ্যাটের উপরে AI বোতাম চেপে অফলাইন মোডে যাওয়া যায়।
- **নিরাপত্তা:** key কখনো `index.html`-এ বসাবেন না। ফাংশন শুধু এই অ্যানালিস্টের কাজের জন্য নির্দেশনা পাঠায়, আর মিনিটে প্রশ্নের সংখ্যা সীমিত রাখে।
- **ডেটা:** প্রশ্নের সাথে শুধু দরকারি অংশ (যেমন একটি জেলার সারাংশ) Google-এ যায়; পুরো ডেটাবেস যায় না।
