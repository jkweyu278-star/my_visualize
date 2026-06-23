from setuptools import setup, find_packages

setup(
    name="my_visualize",
    version="0.3.0",
    packages=find_packages(),
    install_requires=[
        "torch>=1.12.0",
        "numpy",
        "ipython"
    ],
    include_package_data=True,
    package_data={
        "my_visualize.renderer": ["templates/*"],
    },
    author="jkweyu278-star",
    description="Interactive model-agnostic data flow visualization library for PyTorch in Google Colab",
    url="https://github.com/jkweyu278-star/my_visualize.git",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.8",
)
