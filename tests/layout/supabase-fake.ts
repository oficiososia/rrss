import { fake } from '@/test/fakeSupabase';

export const supabase = fake.client;
export const supabaseConfigured = true;
export const supabaseUrl = 'http://localhost:54321';
