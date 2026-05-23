import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
    darkMode: "class",
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		colors: {
  			background: 'var(--app-background)',
  			foreground: 'var(--app-foreground)',
  			card: {
  				DEFAULT: 'var(--app-card)',
  				foreground: 'var(--app-card-foreground)'
  			},
  			popover: {
  				DEFAULT: 'var(--app-popover)',
  				foreground: 'var(--app-popover-foreground)'
  			},
  			primary: {
  				DEFAULT: 'var(--app-primary)',
  				foreground: 'var(--app-primary-foreground)'
  			},
  			secondary: {
  				DEFAULT: 'var(--app-secondary)',
  				foreground: 'var(--app-secondary-foreground)'
  			},
  			muted: {
  				DEFAULT: 'var(--app-muted)',
  				foreground: 'var(--app-muted-foreground)'
  			},
  			accent: {
  				DEFAULT: 'var(--app-accent)',
  				foreground: 'var(--app-accent-foreground)'
  			},
  			destructive: {
  				DEFAULT: 'var(--app-destructive)',
  				foreground: 'var(--app-destructive-foreground)'
  			},
  			border: 'var(--app-border)',
  			input: 'var(--app-input)',
  			ring: 'var(--app-ring)',
  			chart: {
  				'1': 'var(--chart-1)',
  				'2': 'var(--chart-2)',
  				'3': 'var(--chart-3)',
  				'4': 'var(--chart-4)',
  				'5': 'var(--chart-5)'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [tailwindcssAnimate],
};
export default config;
