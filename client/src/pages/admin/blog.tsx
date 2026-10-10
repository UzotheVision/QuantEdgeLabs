import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "@/components/admin/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Plus, Edit, Trash2, Eye, Save, FileText, Calendar, 
  Tag, Search, ArrowUpRight, Clock, BookOpen, Send,
  X, AlertTriangle, CheckCircle2
} from "lucide-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BlogPost, BlogCategory, BlogPostStatus, InsertBlogPost } from "@shared/schema";

const CATEGORIES: { value: BlogCategory; label: string }[] = [
  { value: 'education', label: 'Education' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'risk-management', label: 'Risk Management' },
  { value: 'market-commentary', label: 'Market Commentary' },
  { value: 'news', label: 'News' },
  { value: 'platform-updates', label: 'Platform Updates' },
];

const STATUS_BADGES: Record<BlogPostStatus, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  draft: { variant: "secondary", label: "Draft" },
  published: { variant: "default", label: "Published" },
  archived: { variant: "outline", label: "Archived" },
};

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

interface BlogFormData {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: BlogCategory;
  tags: string;
  heroImageUrl: string;
  metaDescription: string;
  metaKeywords: string;
  authorName: string;
  status: BlogPostStatus;
}

const emptyForm: BlogFormData = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  category: 'education',
  tags: '',
  heroImageUrl: '',
  metaDescription: '',
  metaKeywords: '',
  authorName: 'Trading Education Team',
  status: 'draft',
};

export default function AdminBlogPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'list' | 'editor'>('list');
  const [editorTab, setEditorTab] = useState<'write' | 'preview' | 'seo'>('write');
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
  const [formData, setFormData] = useState<BlogFormData>(emptyForm);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [postToDelete, setPostToDelete] = useState<BlogPost | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: posts = [], isLoading } = useQuery<BlogPost[]>({
    queryKey: ['/api/admin/blog'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertBlogPost) => {
      return apiRequest('POST', '/api/blog', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/blog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blog'] });
      toast({ title: "Success", description: "Blog post created successfully" });
      resetForm();
      setActiveTab('list');
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create post", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertBlogPost> }) => {
      return apiRequest('PATCH', `/api/blog/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/blog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blog'] });
      toast({ title: "Success", description: "Blog post updated successfully" });
      resetForm();
      setActiveTab('list');
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update post", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/blog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/blog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blog'] });
      toast({ title: "Success", description: "Blog post deleted successfully" });
      setDeleteDialogOpen(false);
      setPostToDelete(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete post", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingPost(null);
    setEditorTab('write');
  };

  const handleNewPost = () => {
    resetForm();
    setActiveTab('editor');
  };

  const handleEditPost = (post: BlogPost) => {
    setEditingPost(post);
    setFormData({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || '',
      content: post.content,
      category: post.category,
      tags: post.tags?.join(', ') || '',
      heroImageUrl: post.heroImageUrl || '',
      metaDescription: post.metaDescription || '',
      metaKeywords: post.metaKeywords || '',
      authorName: post.authorName,
      status: post.status,
    });
    setActiveTab('editor');
  };

  const handleSubmit = () => {
    if (!formData.title.trim()) {
      toast({ title: "Error", description: "Title is required", variant: "destructive" });
      return;
    }
    if (!formData.content.trim()) {
      toast({ title: "Error", description: "Content is required", variant: "destructive" });
      return;
    }

    const postData: InsertBlogPost = {
      title: formData.title,
      slug: formData.slug || generateSlug(formData.title),
      excerpt: formData.excerpt || undefined,
      content: formData.content,
      category: formData.category,
      tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      heroImageUrl: formData.heroImageUrl || undefined,
      metaDescription: formData.metaDescription || undefined,
      metaKeywords: formData.metaKeywords || undefined,
      authorName: formData.authorName,
      status: formData.status,
      publishedAt: formData.status === 'published' ? new Date() : undefined,
    };

    if (editingPost) {
      updateMutation.mutate({ id: editingPost.id, data: postData });
    } else {
      createMutation.mutate(postData);
    }
  };

  const handlePublish = () => {
    setFormData(prev => ({ ...prev, status: 'published' }));
    setTimeout(() => handleSubmit(), 100);
  };

  const filteredPosts = posts.filter(post => 
    post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    post.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const publishedCount = posts.filter(p => p.status === 'published').length;
  const draftCount = posts.filter(p => p.status === 'draft').length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Blog Management</h1>
            <p className="text-muted-foreground text-sm mt-1">Create and manage SEO-friendly blog content</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[var(--trade-bullish)] border-green-400/30">
              {publishedCount} Published
            </Badge>
            <Badge variant="outline" className="text-[var(--trade-neutral)] border-amber-400/30">
              {draftCount} Drafts
            </Badge>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'editor')}>
          <TabsList className="bg-muted border border-border">
            <TabsTrigger value="list" data-testid="tab-list">All Posts</TabsTrigger>
            <TabsTrigger value="editor" data-testid="tab-editor">
              {editingPost ? 'Edit Post' : 'New Post'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-6">
            <Card className="bg-card border-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-foreground">Blog Posts</CardTitle>
                  <CardDescription>Manage your published and draft articles</CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search posts..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 w-64 bg-muted border-border"
                      data-testid="input-search-posts"
                    />
                  </div>
                  <Button onClick={handleNewPost} className="bg-sky-600 hover:bg-sky-700" data-testid="button-new-post">
                    <Plus className="h-4 w-4 mr-2" />
                    New Post
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-20 w-full bg-muted" />
                    ))}
                  </div>
                ) : filteredPosts.length === 0 ? (
                  <div className="text-center py-12">
                    <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium text-foreground mb-2">No posts published yet</h3>
                    <p className="text-muted-foreground mb-4">Start creating SEO-friendly content to attract visitors</p>
                    <Button onClick={handleNewPost} className="bg-sky-600 hover:bg-sky-700">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Your First Post
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredPosts.map(post => (
                      <div 
                        key={post.id} 
                        className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border hover:border-border transition-colors"
                        data-testid={`blog-post-${post.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-medium text-foreground truncate">{post.title}</h3>
                            <Badge {...STATUS_BADGES[post.status]}>{STATUS_BADGES[post.status].label}</Badge>
                            <Badge variant="outline" className="text-muted-foreground">{post.category}</Badge>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {post.publishedAt ? format(new Date(post.publishedAt), 'MMM d, yyyy') : 'Not published'}
                            </span>
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              {post.content.split(/\s+/).length} words
                            </span>
                            {post.metaDescription && (
                              <span className="flex items-center gap-1 text-[var(--trade-bullish)]">
                                <CheckCircle2 className="h-3 w-3" />
                                SEO Ready
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          {post.status === 'published' && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              asChild
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <a href={`/blog/${post.slug}`} target="_blank" rel="noopener noreferrer">
                                <ArrowUpRight className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleEditPost(post)}
                            className="text-muted-foreground hover:text-foreground"
                            data-testid={`button-edit-${post.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => { setPostToDelete(post); setDeleteDialogOpen(true); }}
                            className="text-[var(--trade-bearish)] hover:text-[var(--trade-bearish)]"
                            data-testid={`button-delete-${post.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="editor" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-foreground">
                        {editingPost ? 'Edit Post' : 'Create New Post'}
                      </CardTitle>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => { resetForm(); setActiveTab('list'); }}
                        className="text-muted-foreground"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="text-foreground/80">Title *</Label>
                      <Input
                        value={formData.title}
                        onChange={(e) => {
                          setFormData(prev => ({ 
                            ...prev, 
                            title: e.target.value,
                            slug: prev.slug || generateSlug(e.target.value)
                          }));
                        }}
                        placeholder="Enter a compelling title..."
                        className="bg-muted border-border mt-1"
                        data-testid="input-title"
                      />
                    </div>

                    <div>
                      <Label className="text-foreground/80">URL Slug</Label>
                      <Input
                        value={formData.slug}
                        onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
                        placeholder="url-friendly-slug"
                        className="bg-muted border-border mt-1 font-mono text-sm"
                        data-testid="input-slug"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        URL: /blog/{formData.slug || 'your-post-slug'}
                      </p>
                    </div>

                    <Tabs value={editorTab} onValueChange={(v) => setEditorTab(v as 'write' | 'preview' | 'seo')}>
                      <TabsList className="bg-muted">
                        <TabsTrigger value="write">Write</TabsTrigger>
                        <TabsTrigger value="preview">Preview</TabsTrigger>
                        <TabsTrigger value="seo">SEO</TabsTrigger>
                      </TabsList>

                      <TabsContent value="write" className="mt-4">
                        <Textarea
                          value={formData.content}
                          onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                          placeholder="Write your blog post content in Markdown..."
                          className="bg-muted border-border min-h-[400px] font-mono text-sm"
                          data-testid="textarea-content"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Supports Markdown: **bold**, *italic*, # headings, - lists, [links](url), etc.
                        </p>
                      </TabsContent>

                      <TabsContent value="preview" className="mt-4">
                        <div className="min-h-[400px] p-6 rounded-lg bg-muted border border-border prose prose-invert prose-cyan max-w-none">
                          {formData.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {formData.content}
                            </ReactMarkdown>
                          ) : (
                            <p className="text-muted-foreground italic">No content to preview. Start writing!</p>
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="seo" className="mt-4 space-y-4">
                        <div>
                          <Label className="text-foreground/80">Meta Description (SEO)</Label>
                          <Textarea
                            value={formData.metaDescription}
                            onChange={(e) => setFormData(prev => ({ ...prev, metaDescription: e.target.value }))}
                            placeholder="A compelling 150-160 character description for search engines..."
                            className="bg-muted border-border mt-1"
                            rows={3}
                            data-testid="textarea-meta-description"
                          />
                          <p className={`text-xs mt-1 ${
                            formData.metaDescription.length > 160 ? 'text-[var(--trade-bearish)]' : 
                            formData.metaDescription.length >= 120 ? 'text-[var(--trade-bullish)]' : 'text-muted-foreground'
                          }`}>
                            {formData.metaDescription.length}/160 characters (120-160 recommended)
                          </p>
                        </div>

                        <div>
                          <Label className="text-foreground/80">Meta Keywords</Label>
                          <Input
                            value={formData.metaKeywords}
                            onChange={(e) => setFormData(prev => ({ ...prev, metaKeywords: e.target.value }))}
                            placeholder="trading, options, risk management, market analysis"
                            className="bg-muted border-border mt-1"
                            data-testid="input-meta-keywords"
                          />
                          <p className="text-xs text-muted-foreground mt-1">Comma-separated keywords for SEO</p>
                        </div>

                        <div>
                          <Label className="text-foreground/80">Excerpt (Card Preview)</Label>
                          <Textarea
                            value={formData.excerpt}
                            onChange={(e) => setFormData(prev => ({ ...prev, excerpt: e.target.value }))}
                            placeholder="A short summary shown on blog listing cards..."
                            className="bg-muted border-border mt-1"
                            rows={2}
                            data-testid="textarea-excerpt"
                          />
                        </div>

                        <div className="p-4 rounded-lg bg-muted/50 border border-border">
                          <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                            <Eye className="h-4 w-4" />
                            Google Preview
                          </h4>
                          <div className="space-y-1">
                            <p className="text-blue-400 text-lg hover:underline cursor-pointer">
                              {formData.title || 'Your Blog Post Title'}
                            </p>
                            <p className="text-[var(--trade-bullish)] text-sm">
                              quantedgelabs.com/blog/{formData.slug || 'your-post-slug'}
                            </p>
                            <p className="text-muted-foreground text-sm">
                              {formData.metaDescription || formData.excerpt || 'Add a meta description to improve click-through rates from search engines...'}
                            </p>
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="text-foreground text-base">Post Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label className="text-foreground/80">Status</Label>
                      <Select
                        value={formData.status}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, status: v as BlogPostStatus }))}
                      >
                        <SelectTrigger className="bg-muted border-border mt-1" data-testid="select-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="published">Published</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-foreground/80">Category</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, category: v as BlogCategory }))}
                      >
                        <SelectTrigger className="bg-muted border-border mt-1" data-testid="select-category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map(cat => (
                            <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-foreground/80">Tags</Label>
                      <Input
                        value={formData.tags}
                        onChange={(e) => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                        placeholder="options, trading, education"
                        className="bg-muted border-border mt-1"
                        data-testid="input-tags"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Comma-separated tags</p>
                    </div>

                    <div>
                      <Label className="text-foreground/80">Author Name</Label>
                      <Input
                        value={formData.authorName}
                        onChange={(e) => setFormData(prev => ({ ...prev, authorName: e.target.value }))}
                        className="bg-muted border-border mt-1"
                        data-testid="input-author"
                      />
                    </div>

                    <div>
                      <Label className="text-foreground/80">Hero Image URL</Label>
                      <Input
                        value={formData.heroImageUrl}
                        onChange={(e) => setFormData(prev => ({ ...prev, heroImageUrl: e.target.value }))}
                        placeholder="https://..."
                        className="bg-muted border-border mt-1"
                        data-testid="input-hero-image"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle className="text-foreground text-base">Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button 
                      onClick={handleSubmit}
                      disabled={createMutation.isPending || updateMutation.isPending}
                      className="w-full bg-muted hover:bg-muted"
                      data-testid="button-save-draft"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {editingPost ? 'Update Post' : 'Save Draft'}
                    </Button>
                    
                    {formData.status !== 'published' && (
                      <Button 
                        onClick={handlePublish}
                        disabled={createMutation.isPending || updateMutation.isPending}
                        className="w-full bg-sky-600 hover:bg-sky-700"
                        data-testid="button-publish"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Publish Now
                      </Button>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-card border-border border-l-4 border-l-amber-500">
                  <CardContent className="pt-4">
                    <h4 className="font-medium text-[var(--trade-neutral)] mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      SEO Tips
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• Use keywords naturally in your title</li>
                      <li>• Write a compelling meta description (120-160 chars)</li>
                      <li>• Use headers (## and ###) to structure content</li>
                      <li>• Include internal links to other platform pages</li>
                      <li>• Add relevant tags for discoverability</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">Delete Blog Post</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{postToDelete?.title}"? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
              <Button 
                variant="destructive" 
                onClick={() => postToDelete && deleteMutation.mutate(postToDelete.id)}
                disabled={deleteMutation.isPending}
                data-testid="button-confirm-delete"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
