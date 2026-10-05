// --------------- VAIBHAV TYAGI WORK ----------------
"use client";

import { useState } from 'react';
import { UploadCloud, File, CheckCircle, AlertTriangle, Loader2, Search, XCircle } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import useSWR from 'swr';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const fetcher = (url: string) => axios.get(url, {
  headers: { Authorization: 'Bearer student-token' }
}).then(res => res.data);

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState('identity');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Fetch all documents for this user
  const { data: documents, error: docsError, mutate } = useSWR('http://localhost:3001/api/documents', fetcher, {
    refreshInterval: 3000 // Poll every 3 seconds for status updates
  });

  const onDrop = (acceptedFiles: File[]) => {
    setUploadError('');
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'application/pdf': ['.pdf']
    },
    maxSize: 10 * 1024 * 1024,
    multiple: false,
    onDropRejected: (fileRejections) => {
      setUploadError(fileRejections[0].errors[0].message);
    }
  });

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadError('');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('requestedType', docType);

    try {
      await axios.post('http://localhost:3001/api/documents/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': 'Bearer student-token'
        }
      });
      setSelectedFile(null);
      mutate();
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } } };
      setUploadError(error.response?.data?.error || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'quarantined':
      case 'scanning':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Scanning</span>;
      case 'clean':
      case 'queued':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><CheckCircle className="w-3 h-3 mr-1" /> Safe & Queued</span>;
      case 'infected':
      case 'rejected':
      case 'failed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" /> Rejected</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  const handleAccess = async (id: string) => {
    try {
      const res = await axios.get(`http://localhost:3001/api/documents/${id}/access`, {
        headers: { Authorization: 'Bearer student-token' }
      });
      window.open(res.data.url, '_blank');
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || 'Failed to get access URL');
    }
  };

  return (
    <main className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl">C</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">CertiScholar</h1>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-gray-500">
            <span>Student Portal</span>
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">ST</div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Upload Section */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Secure Document Intake</h2>
          <p className="text-sm text-gray-500 mb-6">Upload your identity, income, or academic documents. All files are securely scanned for malware before processing.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
                <select 
                  value={docType} 
                  onChange={(e) => setDocType(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="identity">Identity Proof</option>
                  <option value="income">Income Certificate</option>
                  <option value="marksheet">Marksheet</option>
                </select>
              </div>
              <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-md flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>Do not upload password-protected files. Max size 10MB. Formats: PDF, JPEG, PNG.</p>
              </div>
            </div>

            <div className="md:col-span-2">
              {!selectedFile ? (
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                    isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:bg-gray-50"
                  )}
                >
                  <input {...getInputProps()} />
                  <UploadCloud className="w-10 h-10 mx-auto text-gray-400 mb-3" />
                  <p className="text-sm font-medium text-gray-900">Click or drag file to this area to upload</p>
                  <p className="text-xs text-gray-500 mt-1">Files are quarantined during security scan.</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl p-6 flex flex-col items-center text-center">
                  <File className="w-12 h-12 text-blue-500 mb-3" />
                  <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500 mb-4">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setSelectedFile(null)}
                      disabled={uploading}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleUpload}
                      disabled={uploading}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                      {uploading ? 'Uploading & Scanning...' : 'Secure Submit'}
                    </button>
                  </div>
                </div>
              )}
              {uploadError && (
                <p className="mt-3 text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />
                  {uploadError}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Documents List */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Your Documents</h2>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search..." 
                className="pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {!documents && !docsError ? (
            <div className="py-12 flex justify-center text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : documents?.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <File className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No documents uploaded yet.</p>
            </div>
          ) : (
            <div className="overflow-hidden border border-gray-200 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Document Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <AnimatePresence>
                    {documents?.map((doc: { documentId: string; originalFilename: string; sizeBytes: number; requestedType: string; status: string; createdAt: string }) => (
                      <motion.tr 
                        key={doc.documentId}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <File className="w-5 h-5 text-gray-400 mr-3" />
                            <div>
                              <div className="text-sm font-medium text-gray-900 truncate max-w-[200px]" title={doc.originalFilename}>{doc.originalFilename}</div>
                              <div className="text-xs text-gray-500">{(doc.sizeBytes / 1024).toFixed(1)} KB</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-900 capitalize">{doc.requestedType}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(doc.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          {['clean', 'queued', 'processing', 'completed'].includes(doc.status) ? (
                            <button 
                              onClick={() => handleAccess(doc.documentId)}
                              className="text-blue-600 hover:text-blue-900 font-medium"
                            >
                              View Securely
                            </button>
                          ) : (
                            <span className="text-gray-400 cursor-not-allowed">Unavailable</span>
                          )}
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </main>
  );
}

