'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  UserPlus,
  Search,
  Pencil,
  Trash2,
  ShieldAlert,
  Loader2,
  Mail,
  ShieldCheck,
  Calendar,
  Lock,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    role: 'company_admin',
    isActive: true,
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormData({
      email: '',
      firstName: '',
      lastName: '',
      password: '',
      role: 'company_admin',
      isActive: true,
    });
    setModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      password: '', // Leave empty to keep unchanged
      role: user.role,
      isActive: user.isActive,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.firstName || !formData.lastName) return;

    setSubmitting(true);
    try {
      const url = editingUser ? `/api/admin/users/${editingUser.id}` : '/api/admin/users';
      const method = editingUser ? 'PATCH' : 'POST';

      const payload: any = { ...formData };
      if (editingUser && !payload.password) {
        delete payload.password; // Do not send empty password on update
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setModalOpen(false);
        loadUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Ocurrió un error al guardar.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const executeDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setDeleteTarget(null);
        loadUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Error al eliminar usuario.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-6 bg-card text-card-foreground rounded-2xl border shadow-sm">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
            <Users className="size-8 text-indigo-600 animate-pulse" />
            Usuarios Globales
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Administración completa y control de accesos del sistema AccountExpress.
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-lg shadow-indigo-500/20 transition-all gap-2 self-start sm:self-center"
        >
          <UserPlus className="size-5" />
          Crear Usuario
        </Button>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
        <Input
          placeholder="Buscar usuarios por nombre o correo electrónico..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-11 rounded-xl bg-card border-input text-foreground placeholder-muted-foreground focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Users Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="size-10 text-indigo-500 animate-spin" />
          <p className="text-muted-foreground text-sm">Cargando directorio de usuarios...</p>
        </div>
      ) : filteredUsers.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          <AnimatePresence mode="popLayout">
            {filteredUsers.map((u) => (
              <motion.div
                key={u.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="group relative bg-card text-card-foreground rounded-2xl border hover:border-indigo-500/30 hover:shadow-lg shadow-sm transition-all duration-300 overflow-hidden flex flex-col justify-between"
              >
                <div className="p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="size-11 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-extrabold text-sm border border-indigo-500/10">
                        {`${u.firstName?.[0] ?? ''}${u.lastName?.[0] ?? ''}`.toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-foreground group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-snug">
                          {u.firstName} {u.lastName}
                        </h3>
                        <Badge
                          className={
                            u.role === 'super_admin'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 mt-1'
                              : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border border-indigo-500/20 mt-1'
                          }
                        >
                          {u.role === 'super_admin' ? 'Super Admin' : 'Admin de Empresa'}
                        </Badge>
                      </div>
                    </div>
                    <Badge
                      className={
                        u.isActive
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                          : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20'
                      }
                    >
                      {u.isActive ? 'Activo' : 'Suspendido'}
                    </Badge>
                  </div>

                  <div className="space-y-2 pt-2 text-sm border-t border-border">
                    <div className="flex items-center gap-2 text-foreground/80">
                      <Mail className="size-4 text-muted-foreground" />
                      <span className="truncate">{u.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-foreground/80">
                      <Calendar className="size-4 text-muted-foreground" />
                      <span>Registrado: {new Date(u.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 bg-muted/40 border-t border-border flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">
                    ID: {u.id.substring(0, 8)}...
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-colors"
                      onClick={() => handleOpenEdit(u)}
                      title="Editar"
                    >
                      <Pencil className="size-4.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                      onClick={() => setDeleteTarget(u)}
                      title="Eliminar"
                    >
                      <Trash2 className="size-4.5" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-900/20 rounded-2xl border border-white/5">
          <Users className="size-16 text-slate-600 mb-4" />
          <p className="text-slate-400">No se encontraron usuarios.</p>
        </div>
      )}

      {/* Creation/Editing Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-slate-900 text-white border border-white/10 rounded-2xl max-w-lg shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-indigo-400">
              <UserPlus className="size-6" />
              {editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  Nombre *
                </Label>
                <Input
                  required
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="Nombre"
                  className="bg-slate-950 border-white/10 text-white rounded-xl focus:ring-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  Apellido *
                </Label>
                <Input
                  required
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Apellido"
                  className="bg-slate-950 border-white/10 text-white rounded-xl focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                Email de Contacto *
              </Label>
              <Input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="ejemplo@correo.com"
                className="bg-slate-950 border-white/10 text-white rounded-xl focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                Contraseña {editingUser && '(dejar en blanco para mantener actual)'}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                <Input
                  type="password"
                  required={!editingUser}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Contraseña"
                  className="pl-11 bg-slate-950 border-white/10 text-white rounded-xl focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                Rol de Sistema
              </Label>
              <select
                required
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="block w-full rounded-xl border border-white/10 bg-slate-950 text-white px-4 py-2.5 text-sm focus:ring-indigo-500 outline-none"
              >
                <option value="company_admin">Admin de Empresa</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            {editingUser && (
              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="isActiveUserCheck"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="size-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
                />
                <Label
                  htmlFor="isActiveUserCheck"
                  className="text-slate-300 text-sm font-semibold select-none cursor-pointer"
                >
                  Usuario Activo
                </Label>
              </div>
            )}
            <DialogFooter className="pt-4 border-t border-white/5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white rounded-xl"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20"
              >
                {submitting ? 'Guardando...' : 'Guardar Usuario'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-slate-900 text-white border border-white/10 rounded-2xl max-w-md shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-rose-500">
              <ShieldAlert className="size-6 text-rose-500 animate-bounce" />
              Advertencia: Eliminar Usuario
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-slate-300">
            ¿Estás seguro de que deseas eliminar permanentemente el usuario{' '}
            <span className="font-extrabold text-white">
              {deleteTarget?.firstName} {deleteTarget?.lastName}
            </span>
            ?
            <br />
            <br />
            Esta acción revocará todos sus accesos a empresas. Esta operación es irreversible.
          </div>
          <DialogFooter className="pt-4 border-t border-white/5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              className="text-slate-400 hover:text-white rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={deleting}
              onClick={executeDelete}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl shadow-lg shadow-rose-500/20"
            >
              {deleting ? 'Eliminando...' : 'Sí, Eliminar Usuario'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
