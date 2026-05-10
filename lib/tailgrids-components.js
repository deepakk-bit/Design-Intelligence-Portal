// Seed library of TailGrids components.
//
// TailGrids' free components are HTML + Tailwind snippets published in
// their public repo and on tailgrids.com/components. We carry a curated
// subset here verbatim so the agent can return a result deterministically
// without hitting their CDN on every run. New components can be added by
// appending an entry to TAILGRIDS_COMPONENTS — each one is:
//
//   id       — kebab-case unique slug (used by the picker)
//   name     — human label shown in the UI
//   category — grouping for the picker ("Buttons", "Cards", ...)
//   html     — raw HTML/Tailwind markup, exactly as authored by TailGrids
//
// The HTML still uses TailGrids' custom theme names (bg-primary,
// text-dark, text-body-color, ...). Resolution to arbitrary-value
// equivalents happens in tailgrids-fetch.js so the same source HTML
// renders identically inside our preview iframe and inside the Figma
// React (Tailwind) to Design plugin.

export const TAILGRIDS_COMPONENTS = [
  {
    id: "primary-button",
    name: "Primary Button",
    category: "Buttons",
    html: `<button class="bg-primary hover:bg-blue-dark text-white py-3 px-7 rounded-md text-base font-medium inline-flex items-center justify-center transition">
  Button
</button>`,
  },
  {
    id: "secondary-button",
    name: "Secondary Button",
    category: "Buttons",
    html: `<button class="bg-secondary hover:bg-[#1A8FE3] text-white py-3 px-7 rounded-md text-base font-medium inline-flex items-center justify-center transition">
  Button
</button>`,
  },
  {
    id: "outline-button",
    name: "Outline Button",
    category: "Buttons",
    html: `<button class="border border-primary text-primary hover:bg-primary hover:text-white py-3 px-7 rounded-md text-base font-medium inline-flex items-center justify-center transition">
  Button
</button>`,
  },
  {
    id: "button-with-icon",
    name: "Button with Icon",
    category: "Buttons",
    html: `<button class="bg-primary hover:bg-blue-dark text-white py-3 px-7 rounded-md text-base font-medium inline-flex items-center justify-center transition gap-2">
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14.625 3.375H3.375C2.55 3.375 1.875 4.05 1.875 4.875V13.125C1.875 13.95 2.55 14.625 3.375 14.625H14.625C15.45 14.625 16.125 13.95 16.125 13.125V4.875C16.125 4.05 15.45 3.375 14.625 3.375Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M1.875 6.375H16.125" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  Button
</button>`,
  },
  {
    id: "rounded-button",
    name: "Rounded Button",
    category: "Buttons",
    html: `<button class="bg-primary hover:bg-blue-dark text-white py-3 px-7 rounded-full text-base font-medium inline-flex items-center justify-center transition">
  Button
</button>`,
  },
  {
    id: "card-basic",
    name: "Basic Card",
    category: "Cards",
    html: `<div class="bg-white shadow-card rounded-lg overflow-hidden max-w-[370px] mx-auto">
  <div class="bg-gray-2 h-[220px]"></div>
  <div class="p-8">
    <h3 class="font-semibold text-dark text-xl mb-3">Best UI components for modern websites</h3>
    <p class="text-base text-body-color leading-relaxed mb-7">
      Lorem ipsum dolor sit amet pretium consectetur adipiscing elit. Lorem consectetur adipiscing elit.
    </p>
    <a href="#" class="inline-block py-2 px-7 border border-stroke rounded-full text-base text-body-color hover:border-primary hover:bg-primary hover:text-white transition">
      View Details
    </a>
  </div>
</div>`,
  },
  {
    id: "card-with-badge",
    name: "Card with Badge",
    category: "Cards",
    html: `<div class="bg-white shadow-card rounded-lg overflow-hidden max-w-[370px] mx-auto">
  <div class="bg-gray-2 h-[220px] relative">
    <span class="absolute top-4 left-4 bg-primary text-white text-xs font-semibold py-1 px-3 rounded">New</span>
  </div>
  <div class="p-8">
    <h3 class="font-semibold text-dark text-xl mb-3">A descriptive card heading</h3>
    <p class="text-base text-body-color leading-relaxed">
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent ut nisl.
    </p>
  </div>
</div>`,
  },
  {
    id: "hero-simple",
    name: "Simple Hero",
    category: "Hero",
    html: `<section class="bg-white py-20 lg:py-[120px]">
  <div class="container mx-auto px-4">
    <div class="flex flex-wrap items-center -mx-4">
      <div class="w-full px-4">
        <div class="max-w-[600px] mx-auto text-center">
          <h1 class="font-bold text-dark text-4xl sm:text-5xl md:text-6xl mb-5 leading-tight">
            Build your next project faster
          </h1>
          <p class="text-base sm:text-lg text-body-color leading-relaxed mb-8">
            Ship beautiful interfaces with TailGrids — production-ready Tailwind components for any project.
          </p>
          <div class="flex items-center justify-center gap-4 flex-wrap">
            <a href="#" class="bg-primary hover:bg-blue-dark text-white py-3 px-7 rounded-md text-base font-medium inline-flex items-center justify-center transition">
              Get Started
            </a>
            <a href="#" class="border border-stroke text-dark hover:border-primary hover:text-primary py-3 px-7 rounded-md text-base font-medium inline-flex items-center justify-center transition">
              Learn More
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>`,
  },
  {
    id: "input-text",
    name: "Text Input",
    category: "Forms",
    html: `<div class="max-w-[400px] w-full">
  <label class="block mb-2 text-base font-medium text-dark">Email Address</label>
  <input
    type="email"
    placeholder="you@example.com"
    class="w-full bg-white border border-stroke rounded-md py-3 px-5 text-base text-body-color placeholder-body-color focus:border-primary focus:outline-none"
  />
</div>`,
  },
  {
    id: "alert-success",
    name: "Success Alert",
    category: "Alerts",
    html: `<div class="bg-[#EBF9F1] border-l-4 border-[#1A8245] py-4 px-7 rounded-md max-w-[600px] flex items-start gap-4">
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="shrink-0 mt-0.5">
    <circle cx="10" cy="10" r="10" fill="#1A8245"/>
    <path d="M6 10L8.5 12.5L14 7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <div>
    <h4 class="text-base font-semibold text-[#004634] mb-1">Successfully saved</h4>
    <p class="text-sm text-[#637381]">Your changes have been applied to the workspace.</p>
  </div>
</div>`,
  },
  {
    id: "navbar-simple",
    name: "Simple Navbar",
    category: "Navigation",
    html: `<header class="bg-white border-b border-stroke">
  <div class="container mx-auto px-4 py-4 flex items-center justify-between">
    <a href="#" class="text-xl font-bold text-dark">Brand</a>
    <nav class="flex items-center gap-7">
      <a href="#" class="text-base text-body-color hover:text-primary transition">Home</a>
      <a href="#" class="text-base text-body-color hover:text-primary transition">Features</a>
      <a href="#" class="text-base text-body-color hover:text-primary transition">Pricing</a>
      <a href="#" class="text-base text-body-color hover:text-primary transition">Contact</a>
    </nav>
    <a href="#" class="bg-primary hover:bg-blue-dark text-white py-2 px-5 rounded-md text-sm font-medium transition">
      Sign In
    </a>
  </div>
</header>`,
  },
];

export function listTailgridsComponents() {
  return TAILGRIDS_COMPONENTS.map(({ id, name, category }) => ({
    id,
    name,
    category,
  }));
}

export function getTailgridsComponent(id) {
  return TAILGRIDS_COMPONENTS.find((c) => c.id === id) ?? null;
}
