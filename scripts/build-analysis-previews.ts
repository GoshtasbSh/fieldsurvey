// scripts/build-analysis-previews.ts
// Downloads canonical preview images for the Spatial Analysis Toolbox and writes
// a CREDITS.json registry. Run via `npm run build:previews` (or automatically
// as part of build via the "prebuild" hook).

import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";

const OUT_DIR = "public/analyses-previews";
const ASSETS_DIR = "assets/analyses-previews";

type RemoteImage = {
  cardId: string;
  url: string;
  filename: string;
  sourceTitle: string;
  sourceUrl: string;
  license: string;
  alt: string;
};

const REMOTE_IMAGES: RemoteImage[] = [
  {
    cardId: "A0_colorizer",
    url: "https://upload.wikimedia.org/wikipedia/commons/2/23/U.S._Presidential_election_margin%2C_2004-2016.png",
    filename: "A0_colorizer.png",
    sourceTitle: "Wikimedia Commons — Bplewe",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:U.S._Presidential_election_margin,_2004-2016.png",
    license: "CC-BY-SA-4.0",
    alt: "U.S. counties colored on a blue–red ramp by 2004–2016 presidential vote margin.",
  },
  {
    cardId: "S1_autocorr",
    url: "https://upload.wikimedia.org/wikipedia/commons/5/52/Moran_ScatterPlot_Columbus_Crime.PNG",
    filename: "S1_autocorr.png",
    sourceTitle: "Wikimedia Commons — Lgalvis74",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Moran_ScatterPlot_Columbus_Crime.PNG",
    license: "Public Domain",
    alt: "Moran's I scatterplot of crime rates by neighborhood, Columbus, OH.",
  },
  {
    cardId: "S2_gi_star_q",
    url: "https://upload.wikimedia.org/wikipedia/commons/a/a0/USA_Contiguous_Unemployment_Rate_2020.jpg",
    filename: "S2_gi_star_q.jpg",
    sourceTitle: "Wikimedia Commons — GeogSage",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:USA_Contiguous_Unemployment_Rate_2020.jpg",
    license: "CC-BY-4.0",
    alt: "Getis-Ord Gi* hot/cold spot map of U.S. county unemployment, 2020.",
  },
  {
    cardId: "S3_lisa_q",
    url: "https://upload.wikimedia.org/wikipedia/commons/7/72/USA_Contiguous_Poverty_2020_clusters.jpg",
    filename: "S3_lisa_q.jpg",
    sourceTitle: "Wikimedia Commons — GeogSage",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:USA_Contiguous_Poverty_2020_clusters.jpg",
    license: "CC-BY-SA-4.0",
    alt: "Anselin Local Moran cluster map of U.S. county poverty 2020.",
  },
  {
    cardId: "S6_coverage_response",
    url: "https://upload.wikimedia.org/wikipedia/commons/4/41/Black_Hispanic_Bivariate_Map.png",
    filename: "S6_coverage_response.png",
    sourceTitle: "Wikimedia Commons — Bplewe",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Black_Hispanic_Bivariate_Map.png",
    license: "CC-BY-SA-4.0",
    alt: "Bivariate choropleth of U.S. counties.",
  },
];

type LocalSvg = { cardId: string; filename: string };

const LOCAL_SVGS: LocalSvg[] = [
  { cardId: "S4_satscan", filename: "S4_satscan.svg" },
  { cardId: "S5_distance_decay", filename: "S5_distance_decay.svg" },
  { cardId: "S7_local_geary", filename: "S7_local_geary.svg" },
  { cardId: "S8_bivariate", filename: "S8_bivariate.svg" },
  { cardId: "V2_emerging_hot", filename: "V2_emerging_hot.svg" },
  { cardId: "V2_gwr", filename: "V2_gwr.svg" },
  { cardId: "V2_segregation", filename: "V2_segregation.svg" },
];

async function downloadOne(img: RemoteImage, retries = 4): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(img.url, {
        headers: { "User-Agent": "FieldSurvey/0.1 (analysis-preview builder)" },
      });
      if (!res.ok) {
        if (res.status === 429 && i < retries - 1) {
          const delay = (i + 1) * 30000;
          console.log(`Rate limited (HTTP 429), retrying after ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`Download failed for ${img.url}: HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const dest = join(OUT_DIR, img.filename);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      console.log(`✓ ${img.filename} (${(buf.length / 1024).toFixed(1)} KB)`);
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      const delay = (i + 1) * 30000;
      console.log(`Download failed, retrying after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function copyLocalSvg(filename: string): Promise<void> {
  const src = join(ASSETS_DIR, filename);
  const dest = join(OUT_DIR, filename);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`✓ ${filename} (custom SVG)`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const img of REMOTE_IMAGES) {
    await downloadOne(img);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  for (const svg of LOCAL_SVGS) await copyLocalSvg(svg.filename);

  const credits = {
    generatedAt: new Date().toISOString(),
    images: [
      ...REMOTE_IMAGES.map((img) => ({
        cardId: img.cardId,
        file: img.filename,
        sourceTitle: img.sourceTitle,
        sourceUrl: img.sourceUrl,
        license: img.license,
        alt: img.alt,
      })),
      ...LOCAL_SVGS.map((svg) => ({
        cardId: svg.cardId,
        file: svg.filename,
        sourceTitle: "Custom illustration",
        sourceUrl: "",
        license: "Custom-by-us",
        alt: `Custom SVG preview for ${svg.cardId}`,
      })),
    ],
  };
  await writeFile(join(OUT_DIR, "CREDITS.json"), JSON.stringify(credits, null, 2));
  console.log(`✓ CREDITS.json (${credits.images.length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
