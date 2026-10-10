import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    // Custom screens for mobile-first design (easier iOS/Android transition)
    screens: {
      'xs': '375px',    // iPhone SE, small phones
      'sm': '640px',    // Large phones, small tablets
      'md': '768px',    // Tablets
      'lg': '1024px',   // Laptops
      'xl': '1280px',   // Desktops
      '2xl': '1536px',  // Large screens
    },
    extend: {
      // Touch-friendly sizes (44px minimum for iOS/Android)
      minHeight: {
        'touch': '44px',
        'touch-lg': '48px',
      },
      minWidth: {
        'touch': '44px',
        'touch-lg': '48px',
      },
      // Safe area insets for notched devices
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
      borderRadius: {
        lg: ".5rem", /* 8px — slightly tighter */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
      },
      fontSize: {
        /** Data-dense micro sizes for Bloomberg-style layouts */
        'micro': ['0.5625rem', { lineHeight: '0.875rem' }],   /* 9px — metric labels */
        'data-xs': ['0.6875rem', { lineHeight: '1rem' }],     /* 11px — table cells */
        'data-sm': ['0.75rem', { lineHeight: '1.125rem' }],   /* 12px — stat values */
        'data-base': ['0.8125rem', { lineHeight: '1.25rem' }], /* 13px — body data */
        'data-lg': ['0.9375rem', { lineHeight: '1.375rem' }], /* 15px — emphasized */
        'price-sm': ['1rem', { lineHeight: '1.25rem', letterSpacing: '-0.02em' }],
        'price-md': ['1.25rem', { lineHeight: '1.5rem', letterSpacing: '-0.02em' }],
        'price-lg': ['1.5rem', { lineHeight: '1.75rem', letterSpacing: '-0.03em' }],
      },
      colors: {
        /**
         * PALETTE OVERRIDE — emerald / green / teal / cyan are remapped onto Cold Read.
         *
         * The app carries ~1,200 `bg-emerald-500` / `text-teal-400` style classes
         * accumulated over its life. Rewriting them by hand is a mechanical sweep
         * across a hundred files with real risk of breaking layout, and it would
         * miss every file added afterwards. Remapping the ramps instead means every
         * existing usage resolves to the approved palette without touching a single
         * component, and any new `emerald-500` someone types lands in the system
         * rather than outside it.
         *
         * The scales stay perceptually ordered so the -400 / -500 / -600 variants
         * still read as lighter and darker rather than collapsing to one value.
         */
        emerald: {
          50: '#EEF3F0', 100: '#D8E4DD', 200: '#B4CDC0', 300: '#93B7A2',
          400: '#7FAA8C', 500: '#6E9E7A', // Moss — the approved "up"
          600: '#5C8567', 700: '#4A6B53', 800: '#384F3E', 900: '#26352A', 950: '#161E19',
        },
        green: {
          50: '#EEF3F0', 100: '#D8E4DD', 200: '#B4CDC0', 300: '#93B7A2',
          400: '#7FAA8C', 500: '#6E9E7A',
          600: '#5C8567', 700: '#4A6B53', 800: '#384F3E', 900: '#26352A', 950: '#161E19',
        },
        teal: {
          50: '#EAF5FA', 100: '#CFE9F5', 200: '#A8D7EE', 300: '#8ECFE9',
          400: '#83CAE7', 500: '#78C6E8', // Ice Signal — legacy accent, kept for teal-* classes
          600: '#5AA6C6', 700: '#42839F', 800: '#2F6076', 900: '#1F404F', 950: '#132A34',
        },
        cyan: {
          50: '#EEF8F7', 100: '#DAF3F1', 200: '#B7EDE8', 300: '#94E7DF',
          400: '#70DFD5', 500: '#4FD1C5', // brand cyan — the canonical accent
          600: '#2DC2B4', 700: '#279D92', 800: '#21776F', 900: '#19514C', 950: '#11322F',
        },

        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "var(--trade-bullish)",
          away: "var(--trade-neutral)",
          busy: "var(--trade-bearish)",
          offline: "rgb(156 163 175)",
        },
        bullish: "var(--trade-bullish)",
        bearish: "var(--trade-bearish)",
        neutral: "var(--trade-neutral)",
      },
      /**
       * TERMINAL TYPE SCALE.
       *
       * Components were using ad-hoc pixel values from 10px to 26px — eight sizes with no
       * relationship to each other, so nothing lined up and every new panel invented its
       * own hierarchy. These are the only sizes a dense trading surface needs, named by
       * ROLE so the choice is obvious at the call site:
       *   label  10  — uppercase micro labels (the floor; nothing smaller is readable)
       *   meta   11  — secondary values, units, annotations
       *   body   12  — prose and descriptions
       *   value  13  — the primary number in a row
       *   lead   15  — an emphasised figure
       *   hero   20  — a panel's headline number
       *   mega   26  — the one number a card exists to show
       */
      fontSize: {
        /**
         * ROLE-NAMED TYPE SCALE.
         *
         * The previous scale ran 10 / 11 / 12 / 13 / 15 / 20 / 26. Four of its seven
         * steps sat within 3px of each other, which the eye cannot separate — so a
         * label, a caption, a sentence and a price all landed at effectively the same
         * size, and no amount of careful usage could build hierarchy out of it. The
         * page had one volume because the scale only had one.
         *
         * This one steps at roughly 1.2x and never repeats a size. Adjacent roles are
         * now visibly different, which is the entire job of a scale. Sizes also rise
         * across the board: 10px grey-on-black was illegible in practice.
         *
         * Tracking is set per role rather than per usage — small uppercase needs
         * opening up, large display type needs tightening, and doing that inline was
         * how 1,279 scattered `uppercase` declarations happened.
         */
        label: ['11px', { lineHeight: '1.45', letterSpacing: '0.06em' }],  /* eyebrows, captions */
        meta:  ['13px', { lineHeight: '1.45', letterSpacing: '0.02em' }],  /* secondary text */
        body:  ['15px', { lineHeight: '1.6'  }],                           /* prose — reads at arm's length */
        value: ['17px', { lineHeight: '1.25', letterSpacing: '-0.01em' }], /* data readouts */
        lead:  ['21px', { lineHeight: '1.2',  letterSpacing: '-0.015em' }],/* panel headline number */
        hero:  ['30px', { lineHeight: '1.1',  letterSpacing: '-0.02em' }],
        mega:  ['44px', { lineHeight: '1.02', letterSpacing: '-0.03em' }],
      },
      /** Density steps for a data-dense surface — tighter than Tailwind's defaults. */
      spacing: {
        'card-x': '0.875rem',  // 14px — horizontal card padding
        'card-y': '0.625rem',  // 10px — vertical card padding
        'row-y':  '0.375rem',  // 6px  — between rows in a list
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "border-beam": {
          "100%": {
            "offset-distance": "100%",
          },
        },
        "shimmer-slide": {
          to: {
            transform: "translate(calc(100cqw - 100%), 0)",
          },
        },
        "spin-around": {
          "0%": {
            transform: "translateZ(0) rotate(0)",
          },
          "15%, 35%": {
            transform: "translateZ(0) rotate(90deg)",
          },
          "65%, 85%": {
            transform: "translateZ(0) rotate(270deg)",
          },
          "100%": {
            transform: "translateZ(0) rotate(360deg)",
          },
        },
        "pulse-glow": {
          "0%, 100%": {
            opacity: "1",
            boxShadow: "0 0 20px 5px var(--glow-color, rgba(34, 211, 238, 0.4))",
          },
          "50%": {
            opacity: "0.8",
            boxShadow: "0 0 40px 10px var(--glow-color, rgba(34, 211, 238, 0.6))",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "gradient": "gradient 6s ease infinite",
        "border-beam": "border-beam calc(var(--duration)*1s) infinite linear",
        "shimmer-slide": "shimmer-slide var(--shimmer-duration) ease-in-out infinite alternate",
        "spin-around": "spin-around calc(var(--shimmer-duration) * 2) infinite linear",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
