import type { MetadataRoute } from "next";

const description =
  "HoroLair is a private collection manager for watch collectors to catalogue watches, track values, record notes, and build a visual archive of their collection.";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HoroLair",
    short_name: "HoroLair",
    description,
    start_url: "/",
    display: "standalone",
    background_color: "#07070a",
    theme_color: "#07070a",
  };
}
