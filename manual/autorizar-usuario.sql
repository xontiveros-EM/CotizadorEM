-- Sustituye el marcador por el UID/UUID real del usuario que creaste en Auth.
-- Este acceso se aplica solo al proyecto nuevo de EM Agency.
insert into private.staff_members(user_id)
values ('PEGA-AQUI-EL-UUID-DEL-USUARIO'::uuid)
on conflict (user_id) do update set active = true;

