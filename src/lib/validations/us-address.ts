import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let config: any = {
  zipCodeRegex: '^\\d{5}(-\\d{4})?$',
  phoneRegex: '^\\+?1?[-.\\s]?\\(?[2-9]\\d{2}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}$',
  validStates: [
    'AL',
    'AK',
    'AZ',
    'AR',
    'CA',
    'CO',
    'CT',
    'DE',
    'FL',
    'GA',
    'HI',
    'ID',
    'IL',
    'IN',
    'IA',
    'KS',
    'KY',
    'LA',
    'ME',
    'MD',
    'MA',
    'MI',
    'MN',
    'MS',
    'MO',
    'MT',
    'NE',
    'NV',
    'NH',
    'NJ',
    'NM',
    'NY',
    'NC',
    'ND',
    'OH',
    'OK',
    'OR',
    'PA',
    'RI',
    'SC',
    'SD',
    'TN',
    'TX',
    'UT',
    'VT',
    'VA',
    'WA',
    'WV',
    'WI',
    'WY',
  ],
};

try {
  const configPath = join(process.cwd(), 'rules/us-address-config.json');
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  }
} catch (err) {
  // ignore, use fallback
}

export const usAddressSchema = z.object({
  streetLine1: z.string().min(1, 'Calle requerida').max(100),
  streetLine2: z.string().max(100).optional().nullable().default(''),
  city: z.string().min(1, 'Ciudad requerida').max(50),
  state: z
    .string()
    .length(2, 'Estado debe ser de 2 letras')
    .refine((val) => config.validStates.includes(val.toUpperCase()), {
      message: 'Estado de EE.UU. inválido',
    }),
  zipCode: z.string().regex(new RegExp(config.zipCodeRegex), 'Código Postal (ZIP) inválido'),
  phone: z
    .string()
    .regex(new RegExp(config.phoneRegex), 'Teléfono inválido')
    .optional()
    .nullable()
    .or(z.literal('')),
});

export type UsAddressInput = z.infer<typeof usAddressSchema>;
