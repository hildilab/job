from setuptools import setup, Extension

try:
    from Cython.Distutils import build_ext
    cmdclass = { 'build_ext': build_ext }
except ImportError:
    cmdclass = {}

setup(
    name = 'job',
    version = '0.0.2',
    cmdclass = cmdclass,
    url = 'www.weirdbyte.de',
    author = 'Alexander Rose',
    author_email = 'alexander.rose@weirdbyte.de',
    packages = [
        'job'
    ],
    install_requires = [ 'numpy', 'matplotlib', 'poster', 'fastcluster' ],
    scripts=[
        'job/job.py',
    ]
)