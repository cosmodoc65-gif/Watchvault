import Link from "next/link";
import Image from "next/image";
import { Cormorant_Garamond } from "next/font/google";

const vaultSerif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["600", "700"],
});

function classNames(...values: Array<string | false | undefined | null>) {
  return values.filter(Boolean).join(" ");
}

const frameLg =
  "border-2 border-[hsla(42,42%,60%,0.94)] bg-white/[0.04] shadow-[inset_0_1px_0_0_hsla(43,36%,70%,0.22),0_0_0_1px_rgba(0,0,0,0.56),0_14px_52px_-16px_hsla(41,34%,9%,0.48)]";

const btnPrimary =
  "rounded-2xl border-2 border-[hsla(44,48%,64%,0.98)] bg-gradient-to-b from-[hsla(42,34%,22%,0.97)] via-[hsla(40,29%,14%,0.95)] to-[hsla(38,26%,9%,0.94)] px-5 py-3 text-sm font-semibold tracking-wide text-[hsla(46,50%,97%,0.99)] shadow-[inset_0_1px_0_0_hsla(44,40%,72%,0.36)] transition hover:border-[hsla(45,50%,70%,0.99)] hover:shadow-[inset_0_1px_0_0_hsla(46,42%,78%,0.22),0_0_36px_-12px_hsla(42,44%,22%,0.46)]";

const btnSecondary =
  "rounded-2xl border-2 border-[hsla(42,40%,56%,0.92)] bg-black/48 px-5 py-3 text-sm font-semibold tracking-wide text-white/93 shadow-[inset_0_1px_0_0_hsla(43,32%,62%,0.17)] transition hover:border-[hsla(44,44%,64%,0.97)] hover:bg-black/56 hover:text-white";

const pill =
  "rounded-full border-2 border-[hsla(42,42%,58%,0.92)] bg-black/40 px-3 py-1.5 text-[12px] font-semibold tracking-widest text-white/88 shadow-[inset_0_1px_0_0_hsla(44,34%,66%,0.17)]";

const features = [
  {
    title: "Watch Inventory & Ownership Records",
    body: "Track reference numbers, ownership details, estimated values, purchase information, box / papers, and condition in one private watch inventory.",
  },
  {
    title: "Private Watch Photo Archive",
    body: "Preserve watch photos alongside notes and records locally on your own device, without turning your collection into a public feed.",
  },
  {
    title: "PDF & Data Export",
    body: "Export collection data as CSV, create JSON backups, and generate printable PDF reports with metadata and photos when you need them.",
  },
] as const;

type ShowcaseWatch = {
  category: string;
  model: string;
  detail: string;
  note: string;
  image: {
    src: string;
    alt: string;
    objectPosition: string;
    priority?: boolean;
  };
};

// To replace the sample photography later, update only each image.src, image.alt,
// and image.objectPosition value below. Local files can live in /public and use
// paths such as "/watches/my-chronograph.jpg".
const watchShowcaseItems = [
  {
    category: "Moonphase",
    model: "Longines Conquest Classic Moonphase",
    detail: "Calendar moon display",
    note: "A true moonphase aperture for dress complications.",
    image: {
      src: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Longines_Conquest_Classic_Moonphase_Chronograph.jpg/500px-Longines_Conquest_Classic_Moonphase_Chronograph.jpg",
      alt: "Longines Conquest Classic Moonphase Chronograph watch showing a moonphase complication.",
      objectPosition: "50% 48%",
      priority: true,
    },
  },
  {
    category: "Chronograph",
    model: "Omega Speedmaster Professional",
    detail: "Pushers and subdials",
    note: "A collector-recognizable chronograph layout.",
    image: {
      src: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/OMEGA-Speedmaster-Professional-Front_%28cropped%29.jpg/500px-OMEGA-Speedmaster-Professional-Front_%28cropped%29.jpg",
      alt: "Omega Speedmaster Professional chronograph watch with pushers and three subdials.",
      objectPosition: "50% 50%",
      priority: true,
    },
  },
  {
    category: "GMT",
    model: "Rolex GMT-Master II 16710",
    detail: "24-hour travel bezel",
    note: "Dual-time hardware with the correct GMT character.",
    image: {
      src: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Rolex_GMT_Master_II_-_16710_%28without_background%2C_cropped_to_casing%29.jpg/500px-Rolex_GMT_Master_II_-_16710_%28without_background%2C_cropped_to_casing%29.jpg",
      alt: "Rolex GMT-Master II watch showing a 24-hour bezel and GMT layout.",
      objectPosition: "50% 50%",
    },
  },
  {
    category: "Diver",
    model: "Citizen Promaster Diver 300 m",
    detail: "Timing bezel and lume",
    note: "Purpose-built dive watch proportions and bezel.",
    image: {
      src: "https://upload.wikimedia.org/wikipedia/commons/b/b0/Citizen_Promaster_Eco-Drive_BJ8050-08E_Diver%27s_300_m.jpg",
      alt: "Citizen Promaster Eco-Drive 300 meter diver watch with dive bezel.",
      objectPosition: "50% 52%",
    },
  },
  {
    category: "Field Watch",
    model: "Hamilton Khaki Field Officer",
    detail: "Legible military dial",
    note: "High-contrast numerals in a field-ready case.",
    image: {
      src: "https://upload.wikimedia.org/wikipedia/commons/2/25/HamiltonKhakiFieldOfficer-002.jpg",
      alt: "Hamilton Khaki Field Officer field watch with legible military-style numerals.",
      objectPosition: "50% 48%",
    },
  },
] satisfies readonly ShowcaseWatch[];

function WatchShowcaseCard({
  watch,
  className,
}: {
  watch: ShowcaseWatch;
  className?: string;
}) {
  return (
    <article
      className={classNames(
        "group relative flex min-h-full flex-col overflow-hidden rounded-[1.45rem] border border-[hsla(42,40%,58%,0.38)] bg-[linear-gradient(180deg,rgba(255,255,255,0.065),rgba(255,255,255,0.025)_44%,rgba(0,0,0,0.26))] p-2.5 shadow-[0_18px_46px_-28px_rgba(0,0,0,0.9),inset_0_1px_0_0_hsla(44,38%,74%,0.14)] transition duration-300 ease-out hover:-translate-y-0.5 hover:border-[hsla(44,44%,68%,0.62)] hover:shadow-[0_24px_58px_-30px_hsla(42,42%,18%,0.72),inset_0_1px_0_0_hsla(44,42%,78%,0.2)]",
        className,
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(260px_180px_at_50%_0%,hsla(44,50%,64%,0.12),transparent_68%)] opacity-80 transition duration-300 group-hover:opacity-100" />
      <div className="relative aspect-[5/4] overflow-hidden rounded-[1.05rem] border border-[hsla(42,34%,52%,0.3)] bg-black/52">
        <Image
          src={watch.image.src}
          alt={watch.image.alt}
          fill
          sizes="(min-width: 1024px) 190px, (min-width: 640px) 42vw, 92vw"
          priority={watch.image.priority ?? false}
          className="object-cover transition duration-500 ease-out group-hover:scale-[1.035]"
          style={{ objectPosition: watch.image.objectPosition }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_46%,rgba(0,0,0,0.36)_100%)]" />
        <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-[hsla(44,48%,78%,0.48)] to-transparent" />
      </div>
      <div className="relative flex min-h-[8.5rem] flex-1 flex-col items-center justify-center gap-2 px-3 py-4 text-center">
        <p className="text-[10px] font-semibold uppercase leading-none tracking-[0.24em] text-[hsla(44,48%,76%,0.88)]">
          {watch.category}
        </p>
        <h3 className="text-balance text-[1.05rem] font-semibold leading-tight tracking-[-0.01em] text-white/94">
          {watch.detail}
        </h3>
        <p className="text-[12px] font-medium leading-snug text-white/60">{watch.model}</p>
        <p className="max-w-[15rem] text-[11px] leading-relaxed text-white/43">{watch.note}</p>
      </div>
    </article>
  );
}

function ProductMockup() {
  return (
    <div className={classNames("relative overflow-hidden rounded-[2rem] p-4 sm:p-5 lg:p-6", frameLg)}>
      <div className="absolute inset-0 bg-[radial-gradient(620px_320px_at_22%_12%,hsla(44,48%,58%,0.24),transparent_62%),radial-gradient(520px_280px_at_88%_80%,hsla(42,38%,42%,0.18),transparent_68%)]" />
      <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[hsla(44,50%,78%,0.52)] to-transparent" />
      <div className="relative rounded-[1.6rem] border border-[hsla(42,40%,58%,0.36)] bg-black/36 p-3 shadow-[inset_0_1px_0_0_hsla(44,36%,70%,0.13)] sm:p-4">
        <div className="mb-4 flex flex-col items-center justify-center gap-3 text-center sm:mb-5 sm:flex-row sm:justify-between sm:text-left">
          <div className="flex flex-col items-center justify-center sm:items-start">
            <p className="text-[10px] font-semibold uppercase leading-none tracking-[0.26em] text-[hsla(44,46%,76%,0.88)]">
              Collector showcase
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-white/54">
              Complication-aware references for a private vault
            </p>
          </div>
          <div className="flex items-center justify-center gap-1.5" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-[hsla(44,54%,70%,0.7)]" />
            <span className="h-2 w-2 rounded-full bg-white/18" />
            <span className="h-2 w-2 rounded-full bg-white/12" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-6">
          {watchShowcaseItems.map((watch, index) => (
            <WatchShowcaseCard
              key={watch.category}
              watch={watch}
              className={index < 2 ? "lg:col-span-3" : "lg:col-span-2"}
            />
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-[hsla(42,38%,54%,0.34)] bg-white/[0.035] p-4 sm:mt-5">
          <div className="flex flex-col items-center justify-center gap-1 text-center sm:flex-row sm:justify-between">
            <p className="text-[11px] font-semibold uppercase leading-none tracking-[0.2em] text-white/48">
              Vault status
            </p>
            <p className="text-[11px] font-medium leading-none text-[hsla(44,44%,78%,0.82)]">Local only</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-[hsla(42,46%,42%,0.86)] to-[hsla(46,52%,74%,0.9)]" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 text-center min-[420px]:grid-cols-3">
            {["Private archive", "Collector details", "Export ready"].map((label) => (
              <div
                key={label}
                className="flex min-h-[2.65rem] items-center justify-center rounded-xl border border-[hsla(42,40%,58%,0.42)] bg-black/24 px-2 py-2 text-center text-[10px] font-semibold uppercase leading-snug tracking-[0.16em] text-[hsla(44,44%,82%,0.86)]"
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden">
      <section className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(780px_360px_at_25%_10%,hsla(44,48%,50%,0.12),transparent_60%),radial-gradient(680px_380px_at_88%_12%,hsla(42,38%,42%,0.12),transparent_62%)]" />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-4 pb-16 pt-8 sm:pb-20 lg:min-h-screen lg:justify-center lg:py-16">
          <header className={classNames("flex flex-col gap-5 rounded-3xl p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between", frameLg)}>
            <div>
              <p
                className={classNames(
                  vaultSerif.className,
                  "bg-gradient-to-b from-[hsla(46,50%,99%,0.99)] via-[hsla(44,42%,90%,0.98)] to-[hsla(42,40%,68%,0.97)] bg-clip-text text-3xl font-bold tracking-[0.03em] text-transparent",
                )}
              >
                HoroLair
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsla(44,40%,78%,0.9)]">
                Private. Local. Yours.
              </p>
            </div>
            <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Landing navigation">
              <a href="#features" className="min-h-[40px] rounded-xl px-3 py-2 font-medium text-white/68 transition hover:bg-white/[0.05] hover:text-white">
                Features
              </a>
              <a href="#privacy" className="min-h-[40px] rounded-xl px-3 py-2 font-medium text-white/68 transition hover:bg-white/[0.05] hover:text-white">
                Privacy
              </a>
              <a href="#blog" className="min-h-[40px] rounded-xl px-3 py-2 font-medium text-white/68 transition hover:bg-white/[0.05] hover:text-white">
                Blog
              </a>
              <a href="#about" className="min-h-[40px] rounded-xl px-3 py-2 font-medium text-white/68 transition hover:bg-white/[0.05] hover:text-white">
                About
              </a>
              <Link href="/app" className={classNames("inline-flex min-h-[44px] items-center", btnSecondary)}>
                Open App
              </Link>
            </nav>
          </header>

          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div>
              <p className={classNames("mb-5 inline-flex", pill)}>PRIVATE WATCH VAULT FOR COLLECTORS</p>
              <h1
                className={classNames(
                  vaultSerif.className,
                  "max-w-3xl text-balance text-[3.25rem] font-bold leading-[0.92] tracking-[0.01em] text-white/96 sm:text-[4.75rem] lg:text-[5.35rem]",
                )}
              >
                A quiet lair for serious watch collections.
              </h1>
              <p className="mt-5 max-w-xl text-[13px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,44%,78%,0.86)]">
                Private watch collection tracker for collectors.
              </p>
              <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-white/70 sm:text-[1.08rem]">
                Track wear history, values, service records, photos, notes, cost-per-wear insights, and export-ready
                collection data locally on your own device.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/app" className={classNames("inline-flex min-h-[50px] items-center justify-center sm:min-w-[12rem]", btnPrimary)}>
                  Open App
                </Link>
                <a href="#features" className={classNames("inline-flex min-h-[50px] items-center justify-center sm:min-w-[11rem]", btnSecondary)}>
                  See features
                </a>
              </div>
              <div className="mt-8 grid gap-2 text-[13px] leading-relaxed text-white/54 sm:grid-cols-3">
                <p>Local-first storage</p>
                <p>No account required</p>
                <p>Export-ready archive</p>
              </div>
            </div>

            <ProductMockup />
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.title} className={classNames("rounded-3xl p-5 sm:p-6", frameLg)}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsla(44,44%,74%,0.86)]">
                {feature.title}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-white/62">{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="privacy" className="mx-auto max-w-6xl px-4 pb-12">
        <div className={classNames("rounded-[2rem] p-6 sm:p-8", frameLg)}>
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1fr] lg:items-center">
            <div>
              <p className={classNames("inline-flex", pill)}>PRIVACY BY DEFAULT</p>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white/94 sm:text-3xl">
                Your collection remains yours.
              </h2>
            </div>
            <div className="space-y-4 text-sm leading-relaxed text-white/62">
              <p>
                HoroLair stores your collection locally on this device and browser. It is designed as a serious
                collector tool, not a social network or cloud database.
              </p>
              <p>
                Export a backup whenever you want a portable copy of your watches, photos, notes, and collection data.
              </p>
              <Link href="/app" className={classNames("inline-flex min-h-[48px] items-center justify-center", btnPrimary)}>
                Open App
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="mx-auto max-w-6xl px-4 pb-12">
        <div className={classNames("rounded-[2rem] p-6 sm:p-8", frameLg)}>
          <div className="max-w-3xl">
            <p className={classNames("inline-flex", pill)}>BUILT BY A COLLECTOR</p>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white/94 sm:text-3xl">
              Built by a collector, not a marketplace.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/62 sm:text-base">
              HoroLair is designed for people who want a private, practical way to document and understand their
              collection without turning it into a social feed, sales funnel, or public showcase.
            </p>
          </div>
        </div>
      </section>

      <section id="blog" className="mx-auto max-w-6xl px-4 pb-12">
        <div className={classNames("rounded-[2rem] p-6 sm:p-8", frameLg)}>
          <div className="grid gap-6 md:grid-cols-[0.8fr_1fr] md:items-center">
            <div>
              <p className={classNames("inline-flex", pill)}>BLOG</p>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white/94 sm:text-3xl">
                Collector notes, coming soon.
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-white/62 sm:text-base">
              Future articles will cover collection documentation, service records, export habits, insurance-ready
              organization, and practical ways to understand ownership over time.
            </p>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 pb-12">
        <div className="border-t-2 border-[hsla(42,34%,34%,0.58)] pt-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div>
              <p
                className={classNames(
                  vaultSerif.className,
                  "bg-gradient-to-b from-[hsla(46,50%,99%,0.99)] via-[hsla(44,42%,90%,0.98)] to-[hsla(42,40%,68%,0.97)] bg-clip-text text-3xl font-bold tracking-[0.03em] text-transparent",
                )}
              >
                HoroLair
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsla(44,40%,78%,0.9)]">
                Private. Local. Yours.
              </p>
            </div>
            <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Footer navigation">
              <Link href="/" className="text-white/58 transition hover:text-white">Home</Link>
              <a href="#features" className="text-white/58 transition hover:text-white">Features</a>
              <a href="#privacy" className="text-white/58 transition hover:text-white">Privacy</a>
              <a href="#blog" className="text-white/58 transition hover:text-white">Blog</a>
              <a href="#about" className="text-white/58 transition hover:text-white">About</a>
              <Link href="/app" className="text-white/58 transition hover:text-white">App</Link>
            </nav>
          </div>
          <p className="mt-8 text-xs leading-relaxed text-white/42">
            &copy; {new Date().getFullYear()} HoroLair. Private watch collection tracking for collectors.
          </p>
        </div>
      </footer>
    </main>
  );
}
