import { useEffect } from "react";
import { DEFAULT_SEO, generateSEO, type SEOMetadata } from "@/lib/seo";

interface SEOHeadProps {
  pageKey?: string;
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: "summary" | "summary_large_image";
  keywords?: string[];
  canonical?: string;
}

function setMetaTag(name: string, content: string, isProperty = false) {
  const attribute = isProperty ? "property" : "name";
  let element = document.querySelector(`meta[${attribute}="${name}"]`);
  
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, name);
    document.head.appendChild(element);
  }
  
  element.setAttribute("content", content);
}

function setLinkTag(rel: string, href: string) {
  let element = document.querySelector(`link[rel="${rel}"]`);
  
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", rel);
    document.head.appendChild(element);
  }
  
  element.setAttribute("href", href);
}

export function SEOHead({
  pageKey,
  title,
  description,
  ogTitle,
  ogDescription,
  ogImage,
  twitterCard,
  keywords,
  canonical,
}: SEOHeadProps) {
  const seo = generateSEO(pageKey, {
    title,
    description,
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard,
    keywords,
    canonical,
  });

  useEffect(() => {
    const pageCanonical = seo.canonical || `https://quantedgelabs.net${window.location.pathname === "/" ? "/" : window.location.pathname.replace(/\/$/, "")}`;
    const socialImage = seo.ogImage?.startsWith("http")
      ? seo.ogImage
      : `https://quantedgelabs.net${seo.ogImage || "/og-image.png"}`;

    document.title = seo.title;

    setMetaTag("description", seo.description);
    
    if (seo.keywords && seo.keywords.length > 0) {
      setMetaTag("keywords", seo.keywords.join(", "));
    }

    setMetaTag("og:title", seo.ogTitle || seo.title, true);
    setMetaTag("og:description", seo.ogDescription || seo.description, true);
    setMetaTag("og:type", "website", true);
    setMetaTag("og:site_name", "Quant Edge Labs", true);
    setMetaTag("og:url", pageCanonical, true);
    
    if (seo.ogImage) {
      setMetaTag("og:image", socialImage, true);
    }

    setMetaTag("twitter:card", seo.twitterCard || "summary_large_image");
    setMetaTag("twitter:title", seo.ogTitle || seo.title);
    setMetaTag("twitter:description", seo.ogDescription || seo.description);
    setMetaTag("twitter:url", pageCanonical);
    
    if (seo.ogImage) {
      setMetaTag("twitter:image", socialImage);
    }

    setLinkTag("canonical", pageCanonical);
  }, [seo]);

  return null;
}
