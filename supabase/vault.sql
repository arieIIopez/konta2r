-- Konta2r credential pepper bootstrap.
-- The plaintext pepper is generated inside Postgres and immediately encrypted by
-- Supabase Vault. It is never written to Git, logs, client code, or migration SQL.

begin;

create extension if not exists supabase_vault with schema vault;

revoke all on table vault.secrets from public, anon, authenticated;
revoke all on table vault.decrypted_secrets from public, anon, authenticated;

-- Version 1 is created only once. Future rotations add v2/v3 first, then move
-- KONTA2R_NODE_TOKEN_ACTIVE_KEY_VERSION after live node credentials are rotated.
do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'konta2r_node_token_pepper_v1'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(48), 'hex'),
      'konta2r_node_token_pepper_v1',
      'Konta2r node credential HMAC pepper version 1'
    );
  end if;
end
$$;

commit;
