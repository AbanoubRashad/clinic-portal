import type { Catalog } from "./site";
import { L, type Lang, type Review, type Tenant, type Vertical } from "./types";

const SCHEMA_TYPE: Record<Vertical, string[]> = {
  dental: ["Dentist", "MedicalClinic"],
  derma: ["MedicalClinic"],
  physio: ["MedicalClinic"],
  salon: ["BeautySalon"],
  vet: ["VeterinaryCare"],
  legal: ["LegalService"],
};

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** One LocalBusiness node per branch (Dentist/MedicalClinic for dental), linked to the parent organization. */
export function clinicJsonLd(tenant: Tenant, cat: Catalog, reviews: Review[], lang: Lang, origin: string, pageUrl: string) {
  const orgId = `${origin}/#org`;
  const org = {
    "@type": "Organization",
    "@id": orgId,
    name: L(tenant, "name", lang),
    alternateName: lang === "ar" ? tenant.name_en : tenant.name_ar,
    url: pageUrl,
    logo: `${origin}/favicon.svg`,
    email: tenant.email ?? undefined,
    telephone: tenant.phone ? `+20${tenant.phone.replace(/^0/, "")}` : undefined,
  };
  const branches = cat.branches.map((b) => ({
    "@type": SCHEMA_TYPE[tenant.vertical],
    "@id": `${origin}/#branch-${b.slug}`,
    name: `${L(tenant, "name", lang)} – ${L(b, "district", lang)}`,
    parentOrganization: { "@id": orgId },
    url: pageUrl,
    image: `${origin}/img/clinic-room.jpg`,
    telephone: b.phone ? `+20${b.phone.replace(/^0/, "")}` : undefined,
    priceRange: "EGP",
    currenciesAccepted: "EGP",
    paymentAccepted: "Cash, Credit Card, Mobile Wallet",
    address: {
      "@type": "PostalAddress",
      streetAddress: L(b, "address", lang),
      addressLocality: L(b, "district", lang),
      addressRegion: lang === "ar" ? "القاهرة" : "Cairo",
      addressCountry: "EG",
    },
    geo: b.lat != null && b.lng != null ? { "@type": "GeoCoordinates", latitude: b.lat, longitude: b.lng } : undefined,
    hasMap: b.lat != null ? `https://www.google.com/maps?q=${b.lat},${b.lng}` : undefined,
    openingHoursSpecification: b.hours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${DAY[h.weekday]}`,
      opens: hhmm(h.open_min),
      closes: hhmm(h.close_min),
    })),
    aggregateRating:
      tenant.google_rating && tenant.google_reviews_count
        ? { "@type": "AggregateRating", ratingValue: tenant.google_rating, reviewCount: tenant.google_reviews_count, bestRating: 5 }
        : undefined,
    review: reviews.slice(0, 3).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: lang === "en" && r.author_en ? r.author_en : r.author },
      reviewBody: r.text,
      inLanguage: r.text_lang,
      datePublished: r.published_on,
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
    })),
    medicalSpecialty: tenant.vertical === "dental" ? "Dentistry" : undefined,
    availableService: cat.services.map((s) => ({ "@type": "MedicalProcedure", name: L(s, "name", lang) })),
  }));
  return { "@context": "https://schema.org", "@graph": [org, ...branches] };
}

export function JsonLd({ data }: { data: unknown }) {
  // JSON.stringify output is safe in a script tag once "<" is escaped.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
